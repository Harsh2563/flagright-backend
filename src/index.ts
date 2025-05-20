import express, { Application } from 'express';

class App {
  private app: Application;
  private port: number;

  constructor() {
    this.app = express();
    this.port = process.env.PORT ? parseInt(process.env.PORT, 10) : 3000;
  }

  public listen(): void {
    this.app.listen(this.port, () => {
      console.log(`Server running on port ${this.port}`);
    });
  }
}

class Server {
  private app: App;
  constructor() {
    this.app = new App();
  }

  public async start(): Promise<void> {
    try {
      this.app.listen();
    } catch (error) {
      console.error('Failed to start server:', error);
      process.exit(1);
    }
  }
}

// Initialize and start the server
const server = new Server();
server.start().catch(error => {
  console.error('Failed to start application:', error);
  process.exit(1);
});