# Introduction

This package is destined to be used as a replacement for the default nestjs rabbitmq microservice package. It allows the usage of exchanges to emit events.

## Objective

I developped primarily this package to be able to use the topic exchange feature of rabbitmq with NestJS microservices, since the default one focuses only on using the queues and direct exchange. Other exchanges haven't been tested, but I will try to test and implement them later.

## Warning

This package is in early development and not ready for production. There may be many breaking change during developement.

# Breaking Change

### From v0.1.0 to v0.2.0

The client requires a replyQueue at initialization to be created.
The replyQueue is used as the client queue, the queue option is now used as the default queue to which messages will be sent when no queues are used in the message pattern `this.client.send('queue_name/pattern', { data: 'how are you' });`.


### From v0.2.0 to v0.3.0

- The client no longer requires a replyQueue at initialization to be created.
The `replyQueue` is used as the client queue for response in a request-response message, but leaving it empty will let the library create an anonymous queue.
- By default the queue created will have `exclusive: true` as the only option, it can be customized using `replyQueueOptions`.
- It is recommanded to use a random string generator and set the queue option to exclusive to be able to create more than one client application instance (in the case of using a load balancer for example) and prevent the round-robin nature of rabbitmq to send a message to an instance that didn't make a request. 
- The `queueOptions` is no longer available on `RabbitMQClient` constructor and has been replaced with `replyQueueOptions` which is more explicit.

# How to use

## Sending messages
From 0.3.1, it is possible to configure the message options and send them along the message itself by sending an RMQMessage instead of a string. This allows to use specific options per message.
```ts
import { RMQMessage } from '@lukadriel/nestjs-rabbitmq-transporter/dist/interfaces/rmq-options.interface';
import { Controller, Get, Inject } from '@nestjs/common';
import { ClientProxy } from '@nestjs/microservices';

@Controller()
export class AppController {
  constructor(
    @Inject('RABBITMQ_CLIENT') private readonly rabbitmqClient: ClientProxy,
  ) {}

  @Get()
  getHello() {
    const msg: RMQMessage = {
      content: 'hey there',
      options: {
        persistent: true,
      },
    };
    this.rabbitmqClient.send('hello', msg).subscribe((data) => {
      console.log('response: ', data);
    });
    return 'message sent';
  }
}
```
This also apply to the server response which can return an RMQMessage.

```ts
import { RMQMessage } from '@lukadriel/nestjs-rabbitmq-transporter/dist/interfaces/rmq-options.interface';
import { Controller } from '@nestjs/common';
import { MessagePattern } from '@nestjs/microservices';

@Controller()
export class AppController {
  constructor(private readonly appService: AppService) {}

  @MessagePattern('hello')
  getHello(data: any) {
    console.log('received from client: ', data);
    const response: RMQMessage = {
      content: data,
      options: {
        persistent: true,
      },
    };
    return response;
  }
}

```

## Microservices


### Server
```ts
    import { NestFactory } from '@nestjs/core';
    import { MicroserviceOptions } from '@nestjs/microservices';
    import { AppModule } from './app.module';
    import {
    RabbitMQServer,
    ExchangeType,
    } from '@lukadriel/nestjs-rabbitmq-transporter';

    async function bootstrap() {
        const app = await NestFactory.createMicroservice<MicroserviceOptions>(
            AppModule,
            {
                strategy: new RabbitMQServer({
                    queue: 'queue_name',
                    exchange: 'exchange_name',
                    exchangeType: ExchangeType.TOPIC,
                    urls: ['amqp://localhost:5672'],
                    noAck: true,
                }),
            }
        );
        app.listen();
    }
    bootstrap();
```
### Client

Add a new provider in a module
```ts
    providers: [
        {
            provide: 'RABBITMQ_CLIENT',
            useFactory: () => {
                return new RabbitMQClient({
                    urls: ['amqp://localhost:5672'],
                    exchange: 'exchange_name',
                    exchangeType: ExchangeType.TOPIC,
                    queue: 'server_queue_name',
                    replyQueue: 'client_queue_name',
                    replyQueueOptions: {
                        exclusive: true,
                    }
                    noAck: true,
                });
            },
        },
    ],
```
Inject the provider where you want to use it
```ts
    constructor(@Inject('RABBITMQ_CLIENT') private readonly client: ClientProxy){}
```
Emitting event works as usual. All events will go through the defined exchange topic.

    this.client.emit('pattern', { data: 'how are you' });

For the request-response pattern, the request are sent to a specific queue defined by the pattern 'queue_name/pattern'
```ts
    this.client.send('queue_name/pattern', { data: 'how are you' });
```
## Hybrid Applications

### Server
```ts
    import { NestFactory } from '@nestjs/core';
    import { MicroserviceOptions } from '@nestjs/microservices';
    import { AppModule } from './app.module';
    import {
    RabbitMQServer,
    ExchangeType,
    } from '@lukadriel/nestjs-rabbitmq-transporter';

    async function bootstrap() {
    const app = await NestFactory.create(AppModule);
    app.connectMicroservice<MicroserviceOptions>({
        strategy: new RabbitMQServer({
        queue: 'queue_name',
        exchange: 'exchange_name',
        exchangeType: ExchangeType.TOPIC,
        urls: ['amqp://localhost:5672'],
        noAck: true,
        }),
    });
    await app.startAllMicroservicesAsync();
    await app.listen(3000);
    }
    bootstrap();
```
### Client

Same as for the microservice applications
