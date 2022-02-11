import { ClientProxy, ReadPacket, WritePacket } from '@nestjs/microservices';
import {
  AmqpConnectionManager,
  ChannelWrapper,
  connect,
} from 'amqp-connection-manager';
import { ConfirmChannel, ConsumeMessage } from 'amqplib';
import { EventEmitter } from 'events';
import { RMQOptions } from '../interfaces/rmq-options.interface';
import { fromEvent, merge, Observable, lastValueFrom } from 'rxjs';
import { first, map, share, switchMap } from 'rxjs/operators';
import { Logger } from '@nestjs/common';
import { randomStringGenerator } from '@nestjs/common/utils/random-string-generator.util';
import {
  DISCONNECTED_RMQ_MESSAGE,
  DISCONNECT_EVENT,
  ERROR_EVENT,
} from '../constants';

export class RabbitMQClient extends ClientProxy {
  protected readonly logger = new Logger(ClientProxy.name);
  protected client: AmqpConnectionManager;
  protected channel: ChannelWrapper;
  protected responseEmitter: EventEmitter;
  protected connection: Promise<any>;

  constructor(private readonly options: RMQOptions) {
    super();
    this.initializeSerializer(options);
    this.initializeDeserializer(options);
  }

  public close(): void {
    this.channel && this.channel.close();
    this.client && this.client.close();
    this.channel = null;
    this.client = null;
  }

  public consumeChannel() {
    const { noAck, replyQueue } = this.options;
    this.channel.addSetup((channel: ConfirmChannel) => {
      channel.consume(
        replyQueue,
        (message: ConsumeMessage) => {
          this.responseEmitter.emit(message.properties.correlationId, message);
        },
        {
          noAck,
        },
      );
    });
  }

  public connect(): Promise<any> {
    if (this.client) {
      return this.connection;
    }
    this.client = this.createClient();
    this.handleError(this.client);
    this.handleDisconnectError(this.client);

    const connect$ = this.connect$(this.client);
    this.connection = lastValueFrom(
      this.mergeDisconnectEvent(this.client, connect$).pipe(
        switchMap(() => this.createChannel()),
        share(),
      ),
    );

    return this.connection;
  }

  public createChannel(): Promise<void> {
    return new Promise((resolve) => {
      this.channel = this.client.createChannel({
        json: false,
        setup: (channel: any) => this.setupChannel(channel, resolve),
      });
    });
  }

  public createClient() {
    const { urls, socketOptions } = this.options;
    return connect(urls, socketOptions);
  }

  public mergeDisconnectEvent<T = any>(
    instance: any,
    source$: Observable<T>,
  ): Observable<T> {
    const close$ = fromEvent(instance, DISCONNECT_EVENT).pipe(
      map((err: any) => {
        throw err;
      }),
    );
    return merge(source$, close$).pipe(first());
  }

  public async setupChannel(channel: ConfirmChannel, resolve: any) {
    const {
      replyQueue,
      queueOptions,
      exchange,
      exchangeType,
      exchangeOptions,
      prefetchCount,
      isGlobalPrefetchCount,
    } = this.options;
    await channel.assertExchange(exchange, exchangeType, exchangeOptions);
    await channel.assertQueue(replyQueue, queueOptions);
    await channel.prefetch(prefetchCount, isGlobalPrefetchCount);
    this.responseEmitter = new EventEmitter();
    this.responseEmitter.setMaxListeners(0);
    this.consumeChannel();
    resolve();
  }

  public handleError(client: any): void {
    client.addListener(ERROR_EVENT, (err: any) => this.logger.error(err));
  }

  public handleDisconnectError(client: any): void {
    client.addListener(DISCONNECT_EVENT, (err: any) => {
      this.logger.error(DISCONNECTED_RMQ_MESSAGE);
      this.logger.error(err);

      this.close();
    });
  }

  public async handleMessage(
    packet: unknown,
    callback: (packet: WritePacket) => any,
  ) {
    const { err, response, isDisposed } = await this.deserializer.deserialize(
      packet,
    );
    if (isDisposed || err) {
      callback({
        err,
        response,
        isDisposed: true,
      });
    }
    callback({
      err,
      response,
    });
  }

  protected publish(
    message: ReadPacket,
    callback: (packet: WritePacket) => any,
  ): any {
    try {
      const correlationId = randomStringGenerator();
      const listener = ({ content }: { content: any }) =>
        this.handleMessage(JSON.parse(content.toString()), callback);
      const { queue, replyQueue } = this.options;
      const data = message.pattern.split('/');
      if (data.length === 2) {
        const [destination, pattern] = data;
        message.pattern = pattern;
        const serializedPacket = this.serializer.serialize(message);
        this.responseEmitter.on(correlationId, listener);
        this.channel.sendToQueue(
          destination,
          Buffer.from(JSON.stringify(serializedPacket)),
          {
            correlationId,
            replyTo: replyQueue,
          },
        );
      } else if (data.length === 1) {
        message.pattern = data[0];
        const serializedPacket = this.serializer.serialize(message);
        this.responseEmitter.on(correlationId, listener);
        this.channel.sendToQueue(
          queue,
          Buffer.from(JSON.stringify(serializedPacket)),
          {
            correlationId,
            replyTo: replyQueue,
          },
        );
      } else {
        throw new Error('Invalid arguments for the message pattern');
      }
      return () => this.responseEmitter.removeListener(correlationId, listener);
    } catch (err) {
      callback({ err });
    }
  }

  protected dispatchEvent(packet: ReadPacket): Promise<any> {
    const serializedPacket = this.serializer.serialize(packet);
    const { exchange } = this.options;
    return new Promise<void>((resolve, reject) =>
      this.channel.publish(
        exchange,
        packet.pattern,
        Buffer.from(JSON.stringify(serializedPacket)),
        {
          persistent: true,
        },
        (err) => (err ? reject(err) : resolve()),
      ),
    );
  }
}
