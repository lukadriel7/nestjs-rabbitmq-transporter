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

# How to use

## Microservices

### Server

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

### Client

Add a new provider in a module

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
                    noAck: true,
                });
            },
        },
    ],

Inject the provider where you want to use it

    constructor(@Inject('RABBITMQ_CLIENT') private readonly client: ClientProxy){}

Emitting event works as usual. All events will go through the defined exchange topic.

    this.client.emit('pattern', { data: 'how are you' });

For the request-response pattern, the request are sent to a specific queue defined by the pattern 'queue_name/pattern'

    this.client.send('queue_name/pattern', { data: 'how are you' });

## Hybrid Applications

### Server

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

### Client

Same as for the microservice applications
