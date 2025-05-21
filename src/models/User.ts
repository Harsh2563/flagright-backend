import neo4j from 'neo4j-driver';
import Neo4jDriver from '../services/neo4j.service';
import { IUser } from '../interfaces/user';
import { AppError } from '../utils/appError';

class UserModel {  async create(
    userData: Omit<IUser, 'id' | 'createdAt' | 'updatedAt'>
  ): Promise<IUser> {
    const session = Neo4jDriver.getSession();
    const now = new Date().toISOString();

    try {
      // Validate required fields
      if (!userData.firstName) {
        throw new AppError('First name is required', 400);
      }
      if (!userData.lastName) {
        throw new AppError('Last name is required', 400);
      }
      if (!userData.email) {
        throw new AppError('Email is required', 400);
      }
      
      // Check if a user with the same email already exists
      const existingUserResult = await session.executeRead((tx: any) =>
        tx.run('MATCH (u:User {email: $email}) RETURN u', {
          email: userData.email,
        })
      );

      if (existingUserResult.records.length > 0) {
        throw new AppError(
          `User with email ${userData.email} already exists`,
          409
        );
      }

      // Create the basic user node
      const userResult = await session.executeWrite((tx: any) =>
        tx.run(
          `
          CREATE (u:User {
            id: randomUUID(),
            firstName: $firstName,
            lastName: $lastName,
            email: $email,
            phone: $phone,
            password: $password,
            emailVerified: $emailVerified,
            googleId: $googleId,
            createdAt: $createdAt,
            updatedAt: $createdAt
          })
          RETURN u
          `,
          {
            firstName: userData.firstName,
            lastName: userData.lastName,
            email: userData.email,
            phone: userData.phone || null,
            password: userData.password || null,
            emailVerified: userData.emailVerified,
            googleId: userData.googleId || null,
            createdAt: now,
          }
        )
      );

      const user = this.extractUserFromRecord(userResult);

      // Add Google profile if provided
      if (userData.googleProfile) {
        await session.executeWrite((tx: any) =>
          tx.run(
            `
            MATCH (u:User {id: $userId})
            CREATE (g:GoogleProfile {
              displayName: $displayName,
              email: $email,
              picture: $picture
            })
            CREATE (u)-[:HAS_PROFILE]->(g)
            `,
            {
              userId: user.id,
              displayName: userData.googleProfile?.displayName || null,
              email: userData.googleProfile?.email || null,
              picture: userData.googleProfile?.picture || null,
            }
          )
        );
      }

      // Add address if provided
      if (userData.address) {
        await session.executeWrite((tx: any) =>
          tx.run(
            `
            MATCH (u:User {id: $userId})
            CREATE (a:Address {
              street: $street,
              city: $city,
              state: $state,
              postalCode: $postalCode,
              country: $country
            })
            CREATE (u)-[:HAS_ADDRESS]->(a)
            `,
            {
              userId: user.id,
              street: userData.address?.street || null,
              city: userData.address?.city || null,
              state: userData.address?.state || null,
              postalCode: userData.address?.postalCode || null,
              country: userData.address?.country || null,
            }
          )
        );
      }

      // Add payment methods if provided
      if (userData.paymentMethods && userData.paymentMethods.length > 0) {
        for (const paymentMethod of userData.paymentMethods) {
          await session.executeWrite((tx: any) =>
            tx.run(
              `
              MATCH (u:User {id: $userId})
              CREATE (p:PaymentMethod {
                id: $paymentId,
                type: $paymentType
              })
              CREATE (u)-[:HAS_PAYMENT_METHOD]->(p)
              `,
              {
                userId: user.id,
                paymentId: paymentMethod.id,
                paymentType: paymentMethod.type,
              }
            )
          );
        }
      }

      return user;
    } finally {
      await session.close();
    }
  }
  /**
   * Helper method to extract a basic user from a Neo4j record
   */
  private extractUserFromRecord(result: any): IUser {
    const record = result.records[0];
    const userProps = record.get('u').properties;

    return {
      id: userProps.id,
      firstName: userProps.firstName,
      lastName: userProps.lastName,
      email: userProps.email,
      phone: userProps.phone || undefined,
      password: userProps.password || undefined,
      emailVerified: userProps.emailVerified,
      googleId: userProps.googleId || undefined,
      createdAt: userProps.createdAt,
      updatedAt: userProps.updatedAt,
    };
  }

  /**
   * Find a user by their ID
   */
  async findById(id: string): Promise<IUser> {
    const session = Neo4jDriver.getSession();

    try {
      const result = await session.executeRead((tx: any) =>
        tx.run('MATCH (u:User {id: $id}) RETURN u', { id })
      );

      if (result.records.length === 0) {
        throw new AppError(`User with ID ${id} not found`, 404);
      }

      return this.extractUserFromRecord(result);
    } finally {
      await session.close();
    }
  }
}

export default new UserModel();
