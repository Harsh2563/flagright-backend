import neo4j, {
  QueryResult,
  Record as Neo4jRecord,
  Node as Neo4jNode,
} from 'neo4j-driver';
import Neo4jDriver from '../services/neo4j.service';
import { IUser } from '../interfaces/user';
import { ITransaction } from '../interfaces/transaction'; 
import {
  TransactionStatus,
  PaymentMethodType,
  TransactionType,
} from '../types/enums/TransactionEnums';
import { AppError } from '../utils/appError';
import { IConnectedTransactionInfo, IDirectRelationship, IUserConnections } from '../interfaces/relationship';

class UserModel {
  /**
  /**
   * Upserts a user (updates if ID is provided, otherwise creates new)
   *
   * This method will:
   * 1. If ID is provided: Update the existing user with that ID
   * 2. Otherwise: Create a new user with required fields
   *
   * For both cases, it will also handle related entities:
   * - Address
   * - Payment methods
   * - Shared attribute relationships (email, phone, address, payment)
   *
   * @param userData User data (may include id for updates)
   * @returns Object containing the user data and whether it was newly created
   */
  async upsert(
    userData: Partial<IUser>
  ): Promise<{ user: IUser; isNew: boolean }> {
    const session = Neo4jDriver.getSession();
    const now = new Date().toISOString();

    try {
      // Start a transaction
      const tx = session.beginTransaction();

      try {
        // Handle updates by ID only
        if (userData.id) {
          const existingResult = await tx.run(
            `
            MATCH (u:User {id: $id})
            RETURN u
            `,
            { id: userData.id }
          );

          if (existingResult.records.length > 0) {
            // User with provided ID exists - update it
            const updatedUser = await this.updateExistingUser(
              userData.id,
              userData,
              tx,
              now
            );
            await tx.commit();
            return { user: updatedUser, isNew: false };
          } else {
            throw new AppError(`User with ID ${userData.id} not found`, 404);
          }
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
        // We know all required fields exist at this point for a new user
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
    userData: Partial<IUser>,
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
          u.updatedAt = $updatedAt,
          u.email = $email
      RETURN u
      `,
      {
        userId,
        firstName: userData.firstName,
        lastName: userData.lastName,
        phone: userData.phone || null,
        updatedAt: timestamp,
        email: userData.email,
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
    userData: Partial<IUser>,
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

  /**
   * Retrieves all connections for a given user.
   * Connections include:
   * - Direct relationships (SHARED_EMAIL, SHARED_PHONE, etc.) with other users.
   * - Transactions sent by the user, along with the receiver.
   * - Transactions received by the user, along with the sender.
   *
   * @param userId The ID of the user whose connections are to be fetched.
   * @returns An object containing lists of direct relationships, sent transactions, and received transactions.
   * @throws {AppError} If there is an error during database interaction.
   */
  async getUserConnections(userId: string): Promise<IUserConnections> {
    const session = Neo4jDriver.getSession();
    try {
      // Fetch direct relationships
      const directRelationshipsResult = await session.run(
        `
        MATCH (currentUser:User {id: $userId})-[r:SHARED_EMAIL|SHARED_PHONE|SHARED_ADDRESS|SHARED_PAYMENT_METHOD]-(relatedUser:User)
        RETURN type(r) as relationshipType, relatedUser { .id, .firstName, .lastName, .email } AS relatedUserData
        `,
        { userId }
      );

      const directRelationships: IDirectRelationship[] =
        directRelationshipsResult.records.map((record: Neo4jRecord) => ({
          relationshipType: record.get('relationshipType') as string,
          user: record.get('relatedUserData') as Partial<IUser>,
        }));

      // Fetch transactions (sent and received)
      const transactionsResult = await session.run(
        `
        // Sent transactions
        MATCH (currentUser:User {id: $userId})-[:SENT]->(tx:Transaction)-[:RECEIVED_BY]->(receiver:User)
        OPTIONAL MATCH (tx)-[:FROM_DEVICE]->(d:DeviceInfo)
        OPTIONAL MATCH (d)-[:LOCATED_AT]->(g:Geolocation)
        OPTIONAL MATCH (tx)-[:USED_PAYMENT]->(pt:PaymentType)
        RETURN tx, receiver { .id, .firstName, .lastName, .email } AS relatedUserData, d, g, pt, 'SENT' AS direction
        UNION ALL
        // Received transactions
        MATCH (sender:User)-[:SENT]->(tx:Transaction)-[:RECEIVED_BY]->(currentUser:User {id: $userId})
        OPTIONAL MATCH (tx)-[:FROM_DEVICE]->(d:DeviceInfo)
        OPTIONAL MATCH (d)-[:LOCATED_AT]->(g:Geolocation)
        OPTIONAL MATCH (tx)-[:USED_PAYMENT]->(pt:PaymentType)
        RETURN tx, sender { .id, .firstName, .lastName, .email } AS relatedUserData, d, g, pt, 'RECEIVED' AS direction
        `,
        { userId }
      );

      const sentTransactions: IConnectedTransactionInfo[] = [];
      const receivedTransactions: IConnectedTransactionInfo[] = [];

      transactionsResult.records.forEach((record: Neo4jRecord) => {
        const txNode = record.get('tx') as Neo4jNode;
        const relatedUserData = record.get('relatedUserData') as Partial<IUser>;
        const deviceInfoNode = record.get('d') as Neo4jNode | null;
        const geolocationNode = record.get('g') as Neo4jNode | null;
        const paymentTypeNode = record.get('pt') as Neo4jNode | null;
        const direction = record.get('direction') as 'SENT' | 'RECEIVED';

        const transactionInfo: IConnectedTransactionInfo = {
          transaction: this.parseTransactionProperties(
            txNode,
            deviceInfoNode,
            geolocationNode,
            paymentTypeNode
          ),
          relatedUser: relatedUserData,
        };

        if (direction === 'SENT') {
          sentTransactions.push(transactionInfo);
        } else {
          receivedTransactions.push(transactionInfo);
        }
      });

      // Fetch shared transaction relationships (SHARED_IP, SHARED_DEVICE)
      const sharedTransactionRelationshipsResult = await session.run(
        `
        MATCH (currentUser:User {id: $userId})-[:SENT|:RECEIVED_BY]->(tx1:Transaction)-[r:SHARED_IP|SHARED_DEVICE]->(tx2:Transaction)
        MATCH (tx2)-[:SENT|:RECEIVED_BY]->(relatedUser:User)
        WHERE relatedUser.id <> $userId
        RETURN type(r) AS relationshipType, relatedUser { .id, .firstName, .lastName, .email } AS relatedUserData, count(tx2) AS transactionCount
        `,
        { userId }
      );

      const sharedTransactionRelationships: IDirectRelationship[] =
        sharedTransactionRelationshipsResult.records.map(
          (record: Neo4jRecord) => ({
            relationshipType: `${record.get('relationshipType')} (${record.get(
              'transactionCount'
            )} transactions)`,
            user: record.get('relatedUserData') as Partial<IUser>,
          })
        );

      return {
        directRelationships,
        transactionRelationships: sharedTransactionRelationships, 
        sentTransactions,
        receivedTransactions,
      };
    } catch (error) {
      console.error('Error in getUserConnections:', error);
      throw new AppError(
        'Error while fetching user connections: ' +
          (error instanceof Error ? error.message : String(error)),
        500
      );
    } finally {
      await session.close();
    }
  }

  private parseTransactionProperties(
    txNode: Neo4jNode,
    deviceInfoNode?: Neo4jNode | null,
    geolocationNode?: Neo4jNode | null,
    paymentTypeNode?: Neo4jNode | null
  ): ITransaction {
    const txProps = txNode.properties;

    const getNumber = (value: any): number => {
      if (neo4j.isInt(value)) {
        return value.toNumber();
      }
      return Number(value);
    };

    const deviceInfoContent: ITransaction['deviceInfo'] = {};
    let hasDeviceInfoContent = false;

    if (deviceInfoNode?.properties?.ipAddress) {
      deviceInfoContent.ipAddress = deviceInfoNode.properties
        .ipAddress as string;
      hasDeviceInfoContent = true;
    }

    const geolocationContent: NonNullable<
      ITransaction['deviceInfo']
    >['geolocation'] = {};
    let hasGeolocationContent = false;

    if (geolocationNode?.properties?.city) {
      geolocationContent.city = geolocationNode.properties.city as string;
      hasGeolocationContent = true;
    }
    if (geolocationNode?.properties?.country) {
      geolocationContent.country = geolocationNode.properties.country as string;
      hasGeolocationContent = true;
    }

    if (hasGeolocationContent) {
      deviceInfoContent.geolocation = geolocationContent;
      hasDeviceInfoContent = true;
    }

    return {
      id: txProps.id as string,
      transactionType: txProps.transactionType as TransactionType,
      status: txProps.status as TransactionStatus,
      senderId: txProps.senderId as string,
      receiverId: txProps.receiverId as string,
      amount: getNumber(txProps.amount),
      currency: txProps.currency as string,
      timestamp: txProps.timestamp as string,
      description: txProps.description as string | undefined,
      deviceId: txProps.deviceId as string | undefined, 
      deviceInfo: hasDeviceInfoContent ? deviceInfoContent : undefined,
      paymentMethod: paymentTypeNode?.properties?.type as
        | PaymentMethodType
        | undefined,
      destinationAmount: txProps.destinationAmount
        ? getNumber(txProps.destinationAmount)
        : undefined,
      destinationCurrency: txProps.destinationCurrency as string | undefined,
    };
  }
}

export default new UserModel();
