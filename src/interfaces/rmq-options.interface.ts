import { Serializer, Deserializer } from '@nestjs/microservices';
import { AmqpConnectionManagerOptions } from 'amqp-connection-manager';

export interface RMQOptions {
  /**
   * An array of urls that will be used for the connection to rabbitmq servers
   */
  urls: string[];
  /**
   * Custom data serializer
   */
  serializer?: Serializer;
  /**
   * Custom data deserializer
   */
  deserializer?: Deserializer;
  /** */
  prefetchCount?: number;
  /** */
  isGlobalPrefetchCount?: boolean;
  /** */
  noAck?: boolean;
  /** */
  exchange?: string;
  /** */
  exchangeType?: ExchangeType;
  /** */
  exchangeOptions?: ExchangeOptions;
  /** */
  socketOptions?: AmqpConnectionManagerOptions;
}

export interface RMQServerOptions extends RMQOptions {
  /** */
  queue?: string;
  /** */
  queueOptions?: QueueOptions;
}

export interface RMQClientOptions extends RMQOptions {
  /** */
  queue?: string;
  /** */
  replyQueue?: string;
  /** */
  replyQueueOptions?: QueueOptions;
}

export interface QueueOptions {
  /** */
  exclusive?: boolean;
  /** */
  durable?: boolean;
  /** */
  autoDelete?: boolean;
  /** */
  arguments?: any;
  /** */
  messageTtl?: number;
  /** */
  expires?: number;
  /** */
  deadLetterExchange?: string;
  /** */
  deadLetterRoutingKey?: string;
  /** */
  maxLength?: number;
  /** */
  maxPriority?: number;
}

export interface MessageOptions {
  expiration?: string | number | undefined;
  userId?: string | undefined;
  CC?: string | string[] | undefined;

  mandatory?: boolean | undefined;
  persistent?: boolean | undefined;
  deliveryMode?: boolean | number | undefined;
  BCC?: string | string[] | undefined;

  contentType?: string | undefined;
  contentEncoding?: string | undefined;
  headers?: any;
  priority?: number | undefined;
  messageId?: string | undefined;
  timestamp?: number | undefined;
  type?: string | undefined;
  appId?: string | undefined;
  timeout?: number;
}
export interface PublishOptions extends MessageOptions {
  correlationId?: string | undefined;
  replyTo?: string | undefined;
}

export interface RMQMessage {
  options?: MessageOptions;
  content: string;
}
export interface RMQServerResponse {
  response: RMQMessage | string;
  isDisposed: boolean;
}

export interface ExchangeOptions {
  /** */
  durable?: boolean;
  /** */
  internal?: boolean;
  /** */
  autoDelete?: boolean;
  /** */
  alternateExchange?: string;
  /** */
  arguments?: any;
}

export enum ExchangeType {
  /** */
  DIRECT = 'direct',
  /** */
  TOPIC = 'topic',
  /** */
  HEADERS = 'headers',
  /** */
  FANOUT = 'fanout',
  /** */
  MATCH = 'match',
}
