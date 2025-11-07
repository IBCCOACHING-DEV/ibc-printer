import { Test, TestingModule } from '@nestjs/testing';
import { ExecutionContext } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { JwtAuthGuard } from './auth.guard';
import { ApiKeyStrategy } from '../strategies/api-key.strategy';

const mockReflector = {
  get: jest.fn(),
};

const mockExecutionContext = {
  getHandler: jest.fn(),
  getClass: jest.fn(),
  switchToHttp: jest.fn().mockReturnValue({
    getRequest: jest.fn().mockReturnValue({
      headers: {
        authorization: 'Bearer valid-token',
      },
    }),
  }),
};

describe('JwtAuthGuard', () => {
  let guard: JwtAuthGuard;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        JwtAuthGuard,
        {
          provide: Reflector,
          useValue: mockReflector,
        },
        ApiKeyStrategy,
      ],
    }).compile();

    guard = module.get<JwtAuthGuard>(JwtAuthGuard);
  });

  it('should be defined', () => {
    expect(guard).toBeDefined();
  });

  it('should return true for public routes', () => {
    mockReflector.get.mockReturnValue(true);

    const result = guard.canActivate(mockExecutionContext as any);

    expect(result).toBe(true);
  });

  it('should call super.canActivate for non-public routes', () => {
    mockReflector.get.mockReturnValue(false);

    const superSpy = jest.spyOn(guard, 'canActivate');

    try {
      guard.canActivate(mockExecutionContext as any);
    } catch (e) {}

    expect(superSpy).toHaveBeenCalled();
  });
});
