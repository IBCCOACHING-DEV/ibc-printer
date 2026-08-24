import { Test, TestingModule } from '@nestjs/testing';
import { OutboxPublisherWorker } from './outbox-publisher.worker';
import { OutboxService } from './outbox.service';
import { RabbitMqService } from '../messaging/rabbitmq.service';

describe('OutboxPublisherWorker', () => {
  let worker: OutboxPublisherWorker;

  const outboxService = {
    findDispatchable: jest.fn(),
    markPublished: jest.fn(),
    markFailed: jest.fn(),
  };

  const rabbitMq = {
    publish: jest.fn(),
  };

  beforeEach(async () => {
    jest.clearAllMocks();

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        OutboxPublisherWorker,
        { provide: OutboxService, useValue: outboxService },
        { provide: RabbitMqService, useValue: rabbitMq },
      ],
    }).compile();

    worker = module.get<OutboxPublisherWorker>(OutboxPublisherWorker);
  });

  it('should be defined', () => {
    expect(worker).toBeDefined();
  });

  it('remove o evento do SQLite somente após o ACK do RabbitMQ (confirm channel)', async () => {
    outboxService.findDispatchable.mockResolvedValue([
      {
        id: 'evt-1',
        aggregateType: 'student_checkin',
        aggregateId: '42',
        eventType: 'student.checked_in',
        routingKey: 'checkin.performed',
        payload: JSON.stringify({ studentId: 42 }),
        status: 'pending',
        attempts: 0,
        lastError: null,
        createdAt: new Date(),
        updatedAt: new Date(),
      },
    ]);
    rabbitMq.publish.mockResolvedValue(true);

    await worker.handleTick();

    expect(rabbitMq.publish).toHaveBeenCalledWith('ibc.checkin.events', 'checkin.performed', {
      studentId: 42,
    });
    expect(outboxService.markPublished).toHaveBeenCalledWith('evt-1');
    expect(outboxService.markFailed).not.toHaveBeenCalled();
  });

  it('mantém o evento (status failed) quando o broker não confirma o recebimento', async () => {
    outboxService.findDispatchable.mockResolvedValue([
      {
        id: 'evt-2',
        aggregateType: 'student_checkin',
        aggregateId: '43',
        eventType: 'student.checked_in',
        routingKey: 'checkin.performed',
        payload: JSON.stringify({ studentId: 43 }),
        status: 'pending',
        attempts: 2,
        lastError: null,
        createdAt: new Date(),
        updatedAt: new Date(),
      },
    ]);
    rabbitMq.publish.mockResolvedValue(false);

    await worker.handleTick();

    expect(outboxService.markPublished).not.toHaveBeenCalled();
    expect(outboxService.markFailed).toHaveBeenCalledWith('evt-2', 3, expect.any(String));
  });

  it('não remove nem reenvia quando o payload salvo está corrompido', async () => {
    outboxService.findDispatchable.mockResolvedValue([
      {
        id: 'evt-3',
        aggregateType: 'student_checkin',
        aggregateId: '44',
        eventType: 'student.checked_in',
        routingKey: 'checkin.performed',
        payload: '{ isto não é json',
        status: 'pending',
        attempts: 0,
        lastError: null,
        createdAt: new Date(),
        updatedAt: new Date(),
      },
    ]);

    await worker.handleTick();

    expect(rabbitMq.publish).not.toHaveBeenCalled();
    expect(outboxService.markFailed).toHaveBeenCalledWith('evt-3', 1, expect.any(String));
  });
});
