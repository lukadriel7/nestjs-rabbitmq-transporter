import {
  expect,
  test,
  beforeEach,
  describe,
  afterEach,
  beforeAll,
  afterAll,
} from 'vitest';
import { Test } from '@nestjs/testing';
import { INestApplication } from '@nestjs/common';
import { MicroserviceOptions } from '@nestjs/microservices';
import { StartedTestContainer, GenericContainer } from 'testcontainers';

import { CONNECT_EVENT } from '../src/constants';
import { ExchangeType, RabbitMQServer } from '../src';

test('vitest works', () => {
  expect(CONNECT_EVENT).toEqual('connect');
});

describe('rabbitmq connection suite', () => {
  let container: StartedTestContainer;
  let app: INestApplication;
  beforeAll(async () => {
    container = await new GenericContainer('rabbitmq:management-alpine')
      .withExposedPorts(5672)
      .start();
    const testModule = await Test.createTestingModule({}).compile();
    const rabbitmqUri =
      'amqp://' + container.getHost() + ':' + container.getMappedPort(5672);
    app = testModule.createNestApplication();
    app.connectMicroservice<MicroserviceOptions>({
      strategy: new RabbitMQServer({
        queue: 'queue_name',
        exchange: 'exchange_name',
        exchangeType: ExchangeType.TOPIC,
        urls: [rabbitmqUri],
        noAck: true,
      }),
    });
    await app.startAllMicroservices();
    await app.listen(3000);
  }, 50000);
  afterAll(async () => {
    await app.close();
    await container.stop();
  });
  test('Can connect to RabbitMQ', async () => {
    expect(app.getMicroservices().length).toBeGreaterThan(0);
  });
});
