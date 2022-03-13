import { ClientProxy, ReadPacket, WritePacket } from '@nestjs/microservices';
import {
  AmqpConnectionManager,
  ChannelWrapper,
  connect as connectAMQP,
} from 'amqp-connection-manager';
import { ConfirmChannel, ConsumeMessage } from 'amqplib';
import { EventEmitter } from 'events';
import {
  MessageOptions,
  PublishOptions,
  RMQClientOptions,
  RMQMessage,
} from '../interfaces/rmq-options.interface';
import { fromEvent, merge, Observable, lastValueFrom } from 'rxjs';
import { first, map, share, switchMap } from 'rxjs/operators';
import { Logger } from '@nestjs/common';
import { randomStringGenerator } from '@nestjs/common/utils/random-string-generator.util';
import {
  // CONNECTED_RMQ_MESSAGE,
  // CONNECT_EVENT,
  CONNECT_FAILED_EVENT,
  CONNECT_FAILED_RMQ_MESSAGE,
  DISCONNECTED_RMQ_MESSAGE,
  DISCONNECT_EVENT,
  ERROR_EVENT,
  ERROR_RMQ_MESSAGE,
} from '../constants';

export class RabbitMQClient extends ClientProxy {
  protected readonly logger = new Logger(ClientProxy.name);
  protected client: AmqpConnectionManager;
  protected channel: ChannelWrapper;
  protected responseEmitter: EventEmitter;
  protected connection: Promise<any>;
  protected replyQueue: string;

  constructor(private readonly options: RMQClientOptions) {
    super();
    this.initializeSerializer(options);
    this.initializeDeserializer(options);
  }

  public override connect(): Promise<any> {
    if (this.client) {
      return this.connection;
    }
    this.client = this.createClient();
    this.handleRMQEvents();
    const connect$ = this.connect$(this.client);
    this.connection = lastValueFrom(
      this.mergeDisconnectEvent(this.client, connect$).pipe(
        switchMap(() => this.createChannel()),
        share(),
      ),
    );
    return this.connection;
  }

  public createClient() {
    const { urls, socketOptions } = this.options;
    return connectAMQP(urls, socketOptions);
  }

  public handleRMQEvents() {
    this.client.on(CONNECT_FAILED_EVENT, (err) => {
      this.logger.error(CONNECT_FAILED_RMQ_MESSAGE);
      this.logger.error(err);
    });
    this.client.on(DISCONNECT_EVENT, (err) => {
      this.logger.error(DISCONNECTED_RMQ_MESSAGE);
      this.logger.error(err);
      this.close();
    });
    this.client.on(ERROR_EVENT, (err) => {
      this.logger.error(ERROR_RMQ_MESSAGE);
      this.logger.error(err);
    });
    // Causes error
    // this.client.on(CONNECT_EVENT, (res) => {
    //   this.logger.log(CONNECTED_RMQ_MESSAGE);
    //   this.logger.log(res);
    // });
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

  public createChannel(): Promise<void> {
    return new Promise((resolve) => {
      this.channel = this.client.createChannel({
        json: false,
        setup: (channel: ConfirmChannel) => this.setupChannel(channel, resolve),
      });
    });
  }

  public async setupChannel(channel: ConfirmChannel, resolve: any) {
    const {
      replyQueue,
      replyQueueOptions,
      exchange,
      exchangeType,
      exchangeOptions,
      prefetchCount,
      isGlobalPrefetchCount,
    } = this.options;
    await channel.assertExchange(exchange, exchangeType, exchangeOptions);
    const queueOptions =
      replyQueueOptions !== undefined ? replyQueueOptions : { exclusive: true };
    if (replyQueue !== undefined) {
      this.replyQueue = replyQueue;
      await channel.assertQueue(this.replyQueue, queueOptions);
    } else {
      this.replyQueue = (await channel.assertQueue('', queueOptions)).queue;
    }
    await channel.prefetch(prefetchCount, isGlobalPrefetchCount);
    this.responseEmitter = new EventEmitter();
    this.responseEmitter.setMaxListeners(0);
    this.consumeChannel();
    resolve();
  }

  public consumeChannel() {
    const { noAck } = this.options;
    this.channel.addSetup((channel: ConfirmChannel) => {
      channel.consume(
        this.replyQueue,
        (message: ConsumeMessage) => {
          this.responseEmitter.emit(message.properties.correlationId, message);
        },
        {
          noAck: noAck !== undefined ? noAck : true,
          exclusive: true,
        },
      );
    });
  }

  protected override publish(
    message: ReadPacket<string | RMQMessage>,
    callback: (packet: WritePacket) => any,
  ): any {
    try {
      const correlationId = randomStringGenerator();
      const listener = ({ content }: { content: any }) =>
        this.handleMessage(JSON.parse(content.toString()), callback);
      const { queue } = this.options;
      let messageOptions: MessageOptions;
      if (typeof message.data !== 'string') {
        messageOptions = message.data.options;
        message.data = message.data.content;
      }
      const publishOptions: PublishOptions = {
        replyTo: this.replyQueue,
        ...messageOptions,
        correlationId,
      };
      const data = message.pattern.split('/');
      if (data.length === 2) {
        const [destination, pattern] = data;
        message.pattern = pattern;
        const serializedPacket = this.serializer.serialize(message);
        this.responseEmitter.on(correlationId, listener);
        this.channel.sendToQueue(
          destination,
          Buffer.from(JSON.stringify(serializedPacket)),
          publishOptions,
        );
      } else if (data.length === 1) {
        message.pattern = data[0];
        const serializedPacket = this.serializer.serialize(message);
        this.responseEmitter.on(correlationId, listener);
        this.channel.sendToQueue(
          queue,
          Buffer.from(JSON.stringify(serializedPacket)),
          publishOptions,
        );
      } else {
        throw new Error('Invalid arguments for the message pattern');
      }
      return () => this.responseEmitter.removeListener(correlationId, listener);
    } catch (err) {
      callback({ err });
    }
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

  protected override dispatchEvent(
    packet: ReadPacket<string | RMQMessage>,
  ): Promise<any> {
    let messageOptions: MessageOptions;
    if (typeof packet.data !== 'string') {
      messageOptions = packet.data.options;
      packet.data = packet.data.content;
    }
    const publishOptions: PublishOptions = {
      persistent: true,
      ...messageOptions,
    };
    const serializedPacket = this.serializer.serialize(packet);
    const { exchange } = this.options;
    return new Promise<void>((resolve, reject) =>
      this.channel.publish(
        exchange,
        packet.pattern,
        Buffer.from(JSON.stringify(serializedPacket)),
        publishOptions,
        (err) => (err ? reject(err) : resolve()),
      ),
    );
  }

  public override close(): void {
    this.channel && this.channel.close();
    this.client && this.client.close();
    this.channel = null;
    this.client = null;
  }
}
