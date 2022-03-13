import {
  Server,
  CustomTransportStrategy,
  Transport,
  OutgoingResponse,
} from '@nestjs/microservices';
import { isString, isUndefined } from '@nestjs/common/utils/shared.utils';
import { ConfirmChannel, ConsumeMessage } from 'amqplib';

import {
  AmqpConnectionManager,
  ChannelWrapper,
  connect,
} from 'amqp-connection-manager';
import {
  PublishOptions,
  RMQServerOptions,
  RMQServerResponse,
} from '../interfaces/rmq-options.interface';
import {
  CONNECT_EVENT,
  CONNECT_FAILED_EVENT,
  CONNECT_FAILED_RMQ_MESSAGE,
  DISCONNECTED_RMQ_MESSAGE,
  DISCONNECT_EVENT,
  ERROR_EVENT,
  ERROR_RMQ_MESSAGE,
  NO_MESSAGE_HANDLER,
} from '../constants';
import { RmqContext } from '../ctx-host/rmq.context';

export class RabbitMQServer extends Server implements CustomTransportStrategy {
  transportId?: Transport;
  private server: AmqpConnectionManager;
  private channel: ChannelWrapper;

  constructor(private readonly options: RMQServerOptions) {
    super();
    this.initializeSerializer(options);
    this.initializeDeserializer(options);
  }

  async listen(callback: () => void) {
    this.start(callback);
  }

  createAmqpClient() {
    const { urls, socketOptions } = this.options;
    return connect(urls, socketOptions);
  }

  public async start(callback: any) {
    this.server = this.createAmqpClient();
    this.server.on(CONNECT_EVENT, () => {
      if (this.channel) {
        return;
      }
      this.channel = this.server.createChannel({
        json: false,
        setup: (channel: ConfirmChannel) =>
          this.setupChannel(channel, callback),
      });
    });
    this.handleRMQEvents();
  }

  public handleRMQEvents() {
    this.server.on(CONNECT_FAILED_EVENT, (err) => {
      this.logger.error(CONNECT_FAILED_RMQ_MESSAGE);
      this.logger.error(err);
    });
    this.server.on(DISCONNECT_EVENT, (err) => {
      this.logger.error(DISCONNECTED_RMQ_MESSAGE);
      this.logger.error(err);
      this.close();
    });
    this.server.on(ERROR_EVENT, (err) => {
      this.logger.error(ERROR_RMQ_MESSAGE);
      this.logger.error(err);
    });
    // Causes error
    // this.client.on(CONNECT_EVENT, (res) => {
    //   this.logger.log(CONNECTED_RMQ_MESSAGE);
    //   this.logger.log(res);
    // });
  }

  public async setupChannel(channel: ConfirmChannel, callback: any) {
    const {
      queue,
      queueOptions,
      exchange,
      exchangeType,
      exchangeOptions,
      noAck,
      prefetchCount,
      isGlobalPrefetchCount,
    } = this.options;
    await channel.assertExchange(exchange, exchangeType, exchangeOptions);
    await channel.assertQueue(queue, queueOptions);
    this.messageHandlers.forEach((handler, pattern) => {
      channel.bindQueue(queue, exchange, pattern);
    });
    channel.consume(queue, (msg) => this.handleMessage(msg, channel), {
      noAck: noAck !== undefined ? noAck : true,
    });
    await channel.prefetch(prefetchCount, isGlobalPrefetchCount);
    callback();
  }

  public async handleMessage(message: ConsumeMessage, channel: ConfirmChannel) {
    const rawMessage = JSON.parse(message.content.toString());
    const packet = await this.deserializer.deserialize(rawMessage);
    const pattern = isString(packet.pattern)
      ? packet.pattern
      : JSON.stringify(packet.pattern);
    const rmqContext = new RmqContext([message, channel, pattern]);
    if (isUndefined(message.properties.replyTo)) {
      return this.handleEvent(pattern, packet, rmqContext);
    }
    const handler = this.getHandlerByPattern(pattern);
    if (!handler) {
      const status = 'error';
      const noHandlerPacket: RMQServerResponse = {
        isDisposed: true,
        response: {
          content: JSON.stringify({
            id: message.properties.correlationId,
            err: NO_MESSAGE_HANDLER,
            status,
          }),
        },
      };
      return this.sendMessage(
        noHandlerPacket,
        message.properties.replyTo,
        message.properties.correlationId,
      );
    }
    const response$ = this.transformToObservable(await handler(packet.data));
    const publish = (response: any) => {
      const outgoingResponse = this.serializer.serialize(response);
      this.sendMessage(
        outgoingResponse,
        message.properties.replyTo,
        message.properties.correlationId,
      );
    };
    response$ && this.send(response$, publish);
  }

  public sendMessage(
    message: RMQServerResponse,
    replyTo: any,
    correlationId: string,
  ): void {
    let publishOptions: PublishOptions = {
      correlationId,
    };
    if (typeof message.response !== 'string') {
      publishOptions = { ...message.response.options, ...publishOptions };
      message.response = message.response.content;
    }
    const outgoingResponse = this.serializer.serialize(
      message as unknown as OutgoingResponse,
    );
    const buffer = Buffer.from(JSON.stringify(outgoingResponse));
    this.channel.sendToQueue(replyTo, buffer, publishOptions);
  }

  close() {
    this.channel && this.channel.close();
    this.server && this.server.close();
  }
}
