import { Serializer, Deserializer } from '@nestjs/microservices';
import { AmqpConnectionManagerOptions } from 'amqp-connection-manager';

export interface RMQOptions {
  urls: string[];
  serializer?: Serializer;
  deserializer?: Deserializer;
  queue?: string;
  replyQueue?: string;
  prefetchCount?: number;
  isGlobalPrefetchCount?: boolean;
  noAck?: boolean;
  queueOptions?: QueueOptions;
  exchange?: string;
  exchangeType?: ExchangeType;
  exchangeOptions?: ExchangeOptions;
  socketOptions?: AmqpConnectionManagerOptions;
}

export interface QueueOptions {
  exclusive?: boolean;
  durable?: boolean;
  autoDelete?: boolean;
  arguments?: any;
  messageTtl?: number;
  expires?: number;
  deadLetterExchange?: string;
  deadLetterRoutingKey?: string;
  maxLength?: number;
  maxPriority?: number;
}

export interface ExchangeOptions {
  durable?: boolean;
  internal?: boolean;
  autoDelete?: boolean;
  alternateExchange?: string;
  arguments?: any;
}

export enum ExchangeType {
  DIRECT = 'direct',
  TOPIC = 'topic',
  HEADERS = 'headers',
  FANOUT = 'fanout',
  MATCH = 'match',
}
