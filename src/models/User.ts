import neo4j, { QueryResult } from 'neo4j-driver';
import Neo4jDriver from '../services/neo4j.service';
import { IUser } from '../interfaces/user';
import { AppError } from '../utils/appError';

class UserModel {
  async create(
    userData: Omit<IUser, 'id' | 'createdAt' | 'updatedAt'>
  ): Promise<IUser> {
    const session = Neo4jDriver.getSession();
    const now = new Date().toISOString();

    try {
      // Start a transaction
      const tx = session.beginTransaction();

      try {
        // Check for existing user with same email
        const existingUserResult = await tx.run(
          'MATCH (u:User {email: $email}) RETURN u',
          { email: userData.email }
        );
        if (existingUserResult.records.length > 0) {
          throw new AppError(
            `User with email ${userData.email} already exists`,
            409
          );
        }

        // Create user node
        const userResult = await tx.run(
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
        );

        const user = this.extractUserFromRecord(userResult);

        // Create related nodes (GoogleProfile, Address, PaymentMethod)
        if (userData.googleProfile) {
          await tx.run(
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
          );
        }

        if (userData.address) {
          await tx.run(
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
          );
        }

        if (userData.paymentMethods && userData.paymentMethods.length > 0) {
          for (const paymentMethod of userData.paymentMethods) {
            await tx.run(
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
            );
          }
        }

        // Create shared attribute relationships
        // Shared Email
        if (userData.email) {
          await tx.run(
            `
            MATCH (u1:User {id: $userId})
            MATCH (u2:User)
            WHERE u2.email = $email AND u2.id <> $userId
            CREATE (u1)-[:SHARED_EMAIL]->(u2)
            `,
            { userId: user.id, email: userData.email }
          );
        }

        // Shared Phone
        if (userData.phone) {
          await tx.run(
            `
            MATCH (u1:User {id: $userId})
            MATCH (u2:User)
            WHERE u2.phone = $phone AND u2.id <> $userId
            CREATE (u1)-[:SHARED_PHONE]->(u2)
            `,
            { userId: user.id, phone: userData.phone }
          );
        }

        // Shared Address (match on key fields, e.g., street and city)
        if (userData.address?.street && userData.address?.city) {
          await tx.run(
            `
            MATCH (u1:User {id: $userId})-[:HAS_ADDRESS]->(a1:Address)
            MATCH (u2:User)-[:HAS_ADDRESS]->(a2:Address)
            WHERE a2.street = $street AND a2.city = $city AND u2.id <> $userId
            CREATE (u1)-[:SHARED_ADDRESS]->(u2)
            `,
            {
              userId: user.id,
              street: userData.address.street,
              city: userData.address.city,
            }
          );
        }

        // Shared Payment Method
        if (userData.paymentMethods && userData.paymentMethods.length > 0) {
          for (const paymentMethod of userData.paymentMethods) {
            await tx.run(
              `
              MATCH (u1:User {id: $userId})-[:HAS_PAYMENT_METHOD]->(p1:PaymentMethod)
              MATCH (u2:User)-[:HAS_PAYMENT_METHOD]->(p2:PaymentMethod)
              WHERE p2.id = $paymentId AND u2.id <> $userId
              CREATE (u1)-[:SHARED_PAYMENT_METHOD]->(u2)
              `,
              { userId: user.id, paymentId: paymentMethod.id }
            );
          }
        }

        await tx.commit();
        return user;
      } catch (error) {
        await tx.rollback();
        throw error;
      }
    } finally {
      await session.close();
    }
  }

  private extractUserFromRecord(result: QueryResult): IUser {
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
}

export default new UserModel();
