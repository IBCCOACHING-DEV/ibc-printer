import { Global, Module } from '@nestjs/common';
import { RabbitMqService } from './rabbitmq.service';

/**
 * Módulo global de mensageria (RabbitMQ). Importado uma vez em AppModule;
 * o RabbitMqService fica disponível via injeção de dependência em qualquer
 * outro módulo.
 */
@Global()
@Module({
  providers: [RabbitMqService],
  exports: [RabbitMqService],
})
export class MessagingModule {}
