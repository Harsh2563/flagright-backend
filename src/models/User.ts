// filepath: c:\Users\HARSH RAI\Desktop\Flagright\backend\src\models\User.ts
import neo4j, { QueryResult } from 'neo4j-driver';
import Neo4jDriver from '../services/neo4j.service';
import { IUser } from '../interfaces/user';
import { AppError } from '../utils/appError';

class UserModel {
  /**
   * Upserts a user (creates new or updates existing based on email)
   *
   * This method will:
   * 1. Check if a user with the provided email exists
   * 2. If exists: Update the user with new data
   * 3. If not exists: Create a new user
   *
   * For both cases, it will also handle related entities:
   * - Address
   * - Payment methods
   * - Shared attribute relationships (email, phone, address, payment)
   *
   * @param userData User data excluding id, createdAt, updatedAt which are handled automatically
   * @returns Object containing the user data and whether it was newly created
   */
  async upsert(
    userData: Omit<IUser, 'id' | 'createdAt' | 'updatedAt'>
  ): Promise<{ user: IUser; isNew: boolean }> {
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

        // User exists - perform update
        if (existingUserResult.records.length > 0) {
          const existingUser = this.extractUserFromRecord(existingUserResult);
          const updatedUser = await this.updateExistingUser(
            existingUser.id,
            userData,
            tx,
            now
          );
          await tx.commit();
          return { user: updatedUser, isNew: false };
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
            createdAt: now,
          }
        );

        const user = this.extractUserFromRecord(userResult);

        // Create related nodes (Address, PaymentMethod)
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
        await this.createSharedRelationships(user.id, userData, tx);

        await tx.commit();
        return { user: user, isNew: true };
      } catch (error) {
        await tx.rollback();
        throw new AppError(
          'Error while upserting user: ' +
            (error instanceof Error ? error.message : String(error))
        );
      }
    } finally {
      await session.close();
    }
  }

  /**
   * Updates an existing user with new data
   *
   * This private method handles the update logic for an existing user:
   * 1. Updates basic user properties
   * 2. Handles related entities (delete existing and recreate):
   *    - Address
   *    - Payment methods
   * 3. Updates relationships with other users based on shared attributes
   *
   * @param userId ID of the existing user to update
   * @param userData New user data to apply
   * @param tx Active Neo4j transaction to use
   * @param timestamp ISO timestamp string for the update operation
   * @returns Updated user data
   */
  private async updateExistingUser(
    userId: string,
    userData: Omit<IUser, 'id' | 'createdAt' | 'updatedAt'>,
    tx: any,
    timestamp: string
  ): Promise<IUser> {
    // Update user properties
    const updateResult = await tx.run(
      `
      MATCH (u:User {id: $userId})
      SET u.firstName = $firstName,
          u.lastName = $lastName,
          u.phone = $phone,
          u.updatedAt = $updatedAt
      RETURN u
      `,
      {
        userId,
        firstName: userData.firstName,
        lastName: userData.lastName,
        phone: userData.phone || null,
        updatedAt: timestamp,
      }
    );

    const updatedUser = this.extractUserFromRecord(updateResult);

    // Update or create Address
    if (userData.address) {
      // Delete existing Address if present
      await tx.run(
        `
        MATCH (u:User {id: $userId})-[r:HAS_ADDRESS]->(a:Address)
        DELETE r, a
        `,
        { userId }
      );

      // Create new Address
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
          userId,
          street: userData.address?.street || null,
          city: userData.address?.city || null,
          state: userData.address?.state || null,
          postalCode: userData.address?.postalCode || null,
          country: userData.address?.country || null,
        }
      );
    }

    // Update Payment Methods
    if (userData.paymentMethods && userData.paymentMethods.length > 0) {
      // Delete existing Payment Methods if present
      await tx.run(
        `
        MATCH (u:User {id: $userId})-[r:HAS_PAYMENT_METHOD]->(p:PaymentMethod)
        DELETE r, p
        `,
        { userId }
      );

      // Create new Payment Methods
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
            userId,
            paymentId: paymentMethod.id,
            paymentType: paymentMethod.type,
          }
        );
      }
    }

    // Update shared relationships
    // For each type of relationship, we delete existing ones and recreate based on the updated data

    // Delete existing shared relationships
    await tx.run(
      `
      MATCH (u:User {id: $userId})-[r:SHARED_EMAIL|SHARED_PHONE|SHARED_ADDRESS|SHARED_PAYMENT_METHOD]->()
      DELETE r
      `,
      { userId }
    );

    // Recreate shared relationships
    await this.createSharedRelationships(userId, userData, tx);

    return updatedUser;
  }

  /**
   * Creates shared attribute relationships between users
   *
   * This helper method establishes relationships between users who share:
   * - Email addresses
   * - Phone numbers
   * - Physical addresses
   * - Payment methods
   *
   * @param userId ID of the user to create relationships for
   * @param userData User data containing attributes to check for sharing
   * @param tx Active Neo4j transaction
   */
  private async createSharedRelationships(
    userId: string,
    userData: Omit<IUser, 'id' | 'createdAt' | 'updatedAt'>,
    tx: any
  ): Promise<void> {
    // Shared Email
    if (userData.email) {
      await tx.run(
        `
        MATCH (u1:User {id: $userId})
        MATCH (u2:User)
        WHERE u2.email = $email AND u2.id <> $userId
        CREATE (u1)-[:SHARED_EMAIL]->(u2)
        `,
        { userId, email: userData.email }
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
        { userId, phone: userData.phone }
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
          userId,
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
          { userId, paymentId: paymentMethod.id }
        );
      }
    }
  }

  /**
   * Extracts user data from a Neo4j record
   *
   * @param result The Neo4j query result containing user records
   * @returns User data object conforming to the IUser interface
   */
  private extractUserFromRecord(result: QueryResult): IUser {
    const record = result.records[0];
    const userProps = record.get('u').properties;

    return {
      id: userProps.id,
      firstName: userProps.firstName,
      lastName: userProps.lastName,
      email: userProps.email,
      phone: userProps.phone || undefined,
      createdAt: userProps.createdAt,
      updatedAt: userProps.updatedAt,
    };
  }
  /**
   * Retrieves all users from the database with their associated address and payment details
   *
   * @returns Array of user objects with complete address and payment information
   */
  async getAllUsers(): Promise<IUser[]> {
    const session = Neo4jDriver.getSession();

    try {
      // Query users with optional address and payment method relationships
      const result = await session.run(`
        MATCH (u:User)
        OPTIONAL MATCH (u)-[:HAS_ADDRESS]->(a:Address)
        OPTIONAL MATCH (u)-[:HAS_PAYMENT_METHOD]->(p:PaymentMethod)
        RETURN u, 
               collect(DISTINCT a) AS addresses, 
               collect(DISTINCT p) AS paymentMethods
        ORDER BY u.createdAt DESC
      `);

      if (result.records.length === 0) {
        return [];
      }

      return result.records.map((record) => {
        const userProps = record.get('u').properties;
        const addresses = record.get('addresses');
        const paymentMethods = record.get('paymentMethods');

        // Extract address if available (first non-null address in collection)
        let address = undefined;
        if (addresses && addresses.length > 0 && addresses[0] !== null) {
          const addressNode = addresses[0];
          address = {
            street: addressNode.properties.street || undefined,
            city: addressNode.properties.city || undefined,
            state: addressNode.properties.state || undefined,
            postalCode: addressNode.properties.postalCode || undefined,
            country: addressNode.properties.country || undefined,
          };
        }

        // Extract payment methods if available
        let userPaymentMethods = undefined;
        if (
          paymentMethods &&
          paymentMethods.length > 0 &&
          paymentMethods[0] !== null
        ) {
          userPaymentMethods = paymentMethods
            .map((payment: any) => {
              if (payment === null) return null;
              return {
                id: payment.properties.id,
                type: payment.properties.type,
              };
            })
            .filter((p: any) => p !== null);

          // If no valid payment methods, set to undefined
          if (userPaymentMethods.length === 0) {
            userPaymentMethods = undefined;
          }
        }

        return {
          id: userProps.id,
          firstName: userProps.firstName,
          lastName: userProps.lastName,
          email: userProps.email,
          phone: userProps.phone || undefined,
          address: address,
          paymentMethods: userPaymentMethods,
          createdAt: userProps.createdAt,
          updatedAt: userProps.updatedAt,
        };
      });
    } catch (error) {
      throw new AppError(
        'Error while retrieving users: ' +
          (error instanceof Error ? error.message : String(error))
      );
    } finally {
      session.close();
    }
  }

  /**
   * Finds a user by email address
   *
   * @param email Email address to search for
   * @returns User object if found, null otherwise
   */
  async findByEmail(email: string): Promise<IUser | null> {
    const session = Neo4jDriver.getSession();

    try {
      const result = await session.run(
        'MATCH (u:User {email: $email}) RETURN u',
        { email }
      );

      if (result.records.length === 0) {
        return null;
      }

      return this.extractUserFromRecord(result);
    } finally {
      session.close();
    }
  }
}

export default new UserModel();
