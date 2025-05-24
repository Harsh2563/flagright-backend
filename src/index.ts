import express, { Application } from 'express';
import Neo4jService from './services/neo4j.service';
import userRouter from './routes/user';
import transactionRouter from './routes/transaction';
import relationshipRouter from './routes/relationship';
import 'dotenv/config';
import morgan from 'morgan';
import cors from 'cors';

class App {
  private app: Application;
  private port: number;
  constructor() {
    this.app = express();
    this.port = parseInt(process.env.PORT || '5000', 10);

    this.setupMiddleware();
    this.setupRoutes();
  }

  private setupMiddleware(): void {
    const isDev = process.env.NODE_ENV !== 'production';
    this.app.use(morgan(isDev ? 'dev' : 'combined'));
    this.app.use(express.json());
    this.app.use(express.urlencoded({ extended: true }));
    this.app.use(
      cors({
        origin: process.env.CLIENT_ORIGIN || 'http://localhost:3000', 
        credentials: true,
      })
    );
  }

  private setupRoutes(): void {
    this.app.use('/api/users', userRouter);
    this.app.use('/api/transactions', transactionRouter);
    this.app.use('/api/relationships', relationshipRouter);
  }

  public listen(): void {
    this.app.listen(this.port, () => {
      console.log(`Server running on port ${this.port}`);
    });
  }

  public getApp(): Application {
    return this.app;
  }
}

export class Server {
  private app: App;

  constructor() {
    this.app = new App();
  }
  public async start(): Promise<void> {
    try {
      // Initialize Neo4j connection
      Neo4jService.connect();

      // Verify connection is working
      try {
        await Neo4jService.verifyConnection();
        console.log('Neo4j connection successful!');
      } catch (dbError: any) {
        console.error('Failed to connect to Neo4j database:');
        console.error('Error details:', dbError.message);
        console.error(
          'Please check your database credentials and connection settings.'
        );
        process.exit(1);
      }

      // Start Express server
      this.app.listen();

      // Graceful shutdown
      const shutdownHandler = this.shutdown.bind(this);
      process.on('SIGINT', shutdownHandler);
      process.on('SIGTERM', shutdownHandler);
    } catch (error) {
      console.error('Failed to start server:', error);
      process.exit(1);
    }
  }

  private async shutdown(): Promise<void> {
    console.log('\nShutting down gracefully...');
    try {
      await Neo4jService.close();
      console.log('Neo4j connection closed successfully.');
    } catch (error) {
      console.error('Error closing Neo4j connection:', error);
    }
    process.exit(0);
  }
}

// Initialize and start the server
const server = new Server();
server.start().catch((error) => {
  console.error('Failed to start application:', error);
  process.exit(1);
});
