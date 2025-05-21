import neo4j, { Driver, Session } from 'neo4j-driver';

export default class Neo4jService {
  private static driver: Driver;
  public static connect(): void {
    const uri = process.env.NEO4J_URI || 'neo4j://localhost:7687';
    const user = process.env.NEO4J_USERNAME || 'neo4j';
    const password = process.env.NEO4J_PASSWORD || 'password';

    try {
      Neo4jService.driver = neo4j.driver(
        uri,
        neo4j.auth.basic(user, password),
        {
          maxConnectionLifetime: 3 * 60 * 60 * 1000,
          maxConnectionPoolSize: 50,
          connectionAcquisitionTimeout: 2 * 60 * 1000, // 2 minutes
          disableLosslessIntegers: true,
        }
      );

      console.log(`Neo4j driver initialized (URI: ${uri})`);
    } catch (error) {
      console.error('❌ Failed to initialize Neo4j driver:', error);
      process.exit(1);
    }
  }
  public static async verifyConnection(): Promise<void> {
    const session = Neo4jService.driver.session();
    try {
      const result = await session.run(
        'RETURN "Database connection test successful!" AS message'
      );
      const message = result.records[0].get('message');
      console.log(`Neo4j connection response: ${message}`);

      const versionResult = await session.run(
        'CALL dbms.components() YIELD name, versions, edition RETURN name, versions, edition'
      );
      if (versionResult.records.length > 0) {
        const name = versionResult.records[0].get('name');
        const versions = versionResult.records[0].get('versions')[0];
        const edition = versionResult.records[0].get('edition');
        console.log(`Connected to ${name} ${edition} version ${versions}`);
      }
    } finally {
      await session.close();
    }
  }

  public static getSession(): Session {
    return Neo4jService.driver.session();
  }

  public static async close(): Promise<void> {
    await Neo4jService.driver.close();
    console.log('Neo4j driver closed.');
  }
}
