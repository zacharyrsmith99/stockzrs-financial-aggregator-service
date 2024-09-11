import financialAggregatorFactory from "./kafka/kafkaAggregatorFactory";
import BaseLogger from "./utils/logger";
import path from "path";

async function start() {
  const logger = new BaseLogger(path.join(__dirname, "app.log"));
  try {
    await financialAggregatorFactory(logger);
    logger.info("Financial Aggregator Service started successfully");
  } catch (error) {
    logger.error(`Failed to start Financial Aggregator Service: ${error}`);
    process.exit(1);
  }
}

start();
