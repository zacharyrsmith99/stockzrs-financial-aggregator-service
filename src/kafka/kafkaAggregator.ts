import { Kafka, Consumer, Producer } from "kafkajs";
import { DateTime } from "luxon";
import BaseLogger from "../utils/logger";

interface FinancialData {
  symbol: string;
  price: number;
  timestamp: number;
}

interface AggregatedData {
  symbol: string;
  maxPrice: number;
  minPrice: number;
  closingPrice: number;
  count: number;
  openTimestamp: number;
  closeTimestamp: number;
}

export default class FinancialAggregator {
  private consumer: Consumer;
  private producer: Producer;
  private aggregatedData: Map<string, AggregatedData> = new Map();
  private intervals: Map<string, NodeJS.Timeout> = new Map();
  private readonly intervalDuration = 90000; // 90 seconds just in case we receive late data
  private cleanupInterval: NodeJS.Timeout | null = null;
  private logger: BaseLogger;

  constructor(kafka: Kafka, logger: BaseLogger) {
    this.consumer = kafka.consumer({ groupId: "financial-aggregator" });
    this.producer = kafka.producer();
    this.logger = logger;
  }

  private processData(key: string, data: FinancialData) {
    let aggregated = this.aggregatedData.get(key);
    if (!aggregated) {
      aggregated = {
        symbol: data.symbol,
        maxPrice: data.price,
        minPrice: data.price,
        closingPrice: data.price,
        count: 1,
        openTimestamp: data.timestamp,
        closeTimestamp: data.timestamp,
      };
      this.setInterval(key);
    } else {
      aggregated.maxPrice = Math.max(aggregated.maxPrice, data.price);
      aggregated.minPrice = Math.min(aggregated.minPrice, data.price);
      aggregated.closingPrice = data.price;
      aggregated.count += 1;
      aggregated.closeTimestamp = data.timestamp;
    }
    this.aggregatedData.set(key, aggregated);
  }

  private setInterval(key: string) {
    if (!this.intervals.has(key)) {
      const interval = setTimeout(() => {
        this.sendAggregatedData(key);
      }, this.intervalDuration);
      this.intervals.set(key, interval);
    }
  }

  private async sendAggregatedData(key: string) {
    const data = this.aggregatedData.get(key);
    if (data) {
      const dateTimeKey = DateTime.fromSeconds(data.openTimestamp).toFormat(
        "yyyy-MM-dd HH:mm",
      );
      try {
        const body = {
          topic: "minute-aggregated-financial-updates",
          messages: [
            {
              key: dateTimeKey,
              value: JSON.stringify(data),
            },
          ],
        };
        this.logger.info(
          `Sent aggregated data for (${key}) with body (${$body})`,
        );
        await this.producer.send(body);
      } catch (error) {
        this.logger.error(`Error sending aggregated data: (${error})`);
      }
    }
    this.clearAggregation(key);
  }

  private clearAggregation(key: string) {
    this.aggregatedData.delete(key);
    const interval = this.intervals.get(key);
    if (interval) {
      clearTimeout(interval);
      this.intervals.delete(key);
    }
  }

  private cleanupOldData() {
    const tenMinutesAgo = DateTime.now().minus({ minutes: 10 }).toSeconds();
    for (const [key, data] of this.aggregatedData.entries()) {
      if (data.openTimestamp < tenMinutesAgo) {
        this.logger.info(`Cleaning up stale data for key: (${key})`);
        this.sendAggregatedData(key);
      }
    }
  }

  public async start() {
    const consumerTopic = "raw-financial-updates";
    await this.consumer.connect();
    this.logger.info(`Connected to Kafka consumer successfully.`);
    await this.producer.connect();
    this.logger.info(`Connected to Kafka producer successfully.`);
    await this.consumer.subscribe({
      topic: consumerTopic,
      fromBeginning: false,
    });
    this.logger.info(
      `Subscribed to (${consumerTopic}) Kafka topic successfully.`,
    );

    await this.consumer.run({
      eachMessage: async ({ message }) => {
        if (message.key && message.value) {
          const key = message.key.toString();
          const data: FinancialData = JSON.parse(message.value.toString());
          this.processData(key, data);
        }
      },
    });

    this.cleanupInterval = setInterval(
      () => this.cleanupOldData(),
      10 * 60 * 1000,
    );
  }

  public async stop() {
    if (this.cleanupInterval) {
      clearInterval(this.cleanupInterval);
    }

    for (const interval of this.intervals.values()) {
      clearTimeout(interval);
    }
    this.intervals.clear();

    for (const [key, data] of this.aggregatedData.entries()) {
      await this.sendAggregatedData(key);
    }

    await this.consumer.disconnect();
    await this.producer.disconnect();
  }
}
