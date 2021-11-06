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
import { RMQOptions } from '../interfaces/rmq-options.interface';
import { Observable } from 'rxjs';
import {
  CONNECT_EVENT,
  DISCONNECTED_RMQ_MESSAGE,
  DISCONNECT_EVENT,
  NO_MESSAGE_HANDLER,
} from '../constants';
import { RmqContext } from '../ctx-host/rmq.context';

export class RabbitMQServer extends Server implements CustomTransportStrategy {
  transportId?: Transport;
  private server: AmqpConnectionManager;
  private channel: ChannelWrapper;

  constructor(private readonly options: RMQOptions) {
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
    this.server.on(DISCONNECT_EVENT, (err: any) => {
      this.logger.error(DISCONNECTED_RMQ_MESSAGE);
      this.logger.error(err);
    });
  }

  public async setupChannel(channel: ConfirmChannel, callback: any) {
    const {
      queue,
      queueOptions,
      exchange,
      exchangeType,
      exchangeOptions,
      noAck,
    } = this.options;
    await channel.assertExchange(exchange, exchangeType, exchangeOptions);
    await channel.assertQueue(queue, queueOptions);
    this.messageHandlers.forEach((handler, pattern) => {
      channel.bindQueue(queue, exchange, pattern);
    });
    channel.consume(queue, (msg) => this.handleMessage(msg, channel), {
      noAck: noAck ? noAck : true,
    });
    callback();
  }

  public async handleMessage(message: ConsumeMessage, channel: ConfirmChannel) {
    const rawMessage = JSON.parse(message.content.toString());
    const packet = this.deserializer.deserialize(rawMessage);
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
      const noHandlerPacket = {
        id: message.properties.correlationId,
        err: NO_MESSAGE_HANDLER,
        status,
      };
      return this.sendMessage(
        noHandlerPacket,
        message.properties.replyTo,
        message.properties.correlationId,
      );
    }
    const response$ = this.transformToObservable(
      await handler(packet.data),
    ) as Observable<any>;
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

  public sendMessage<T = any>(
    message: T,
    replyTo: any,
    correlationId: string,
  ): void {
    const outgoingResponse = this.serializer.serialize(
      message as unknown as OutgoingResponse,
    );
    const buffer = Buffer.from(JSON.stringify(outgoingResponse));
    this.channel.sendToQueue(replyTo, buffer, {
      correlationId,
    });
  }

  close() {
    this.channel && this.channel.close();
    this.server && this.server.close();
  }
}
