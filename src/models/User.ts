import neo4j, {
  QueryResult,
  Record as Neo4jRecord,
  Node as Neo4jNode,
} from 'neo4j-driver';
import Neo4jDriver from '../services/neo4j.service';
import {
  IUser,
  IUserSearchQuery,
  IUserSearchResult,
  IShortestPathResult,
} from '../interfaces/user';
import { ITransaction } from '../interfaces/transaction';
import {
  TransactionStatus,
  PaymentMethodType,
  TransactionType,
} from '../types/enums/TransactionEnums';
import { AppError } from '../utils/appError';
import {
  IConnectedTransactionInfo,
  IDirectRelationship,
  IUserConnections,
} from '../interfaces/relationship';

class UserModel {
  /**
   * Executes a database operation within a Neo4j session and handles common error patterns
   * @param operation Function that performs the database operation
   * @returns Result of the operation
   * @throws AppError if the operation fails
   */
  private async executeDbOperation<T>(
    operation: (session: any) => Promise<T>,
    errorMessage: string = 'Database operation failed'
  ): Promise<T> {
    const session = Neo4jDriver.getSession();
    try {
      return await operation(session);
    } catch (error) {
      if (error instanceof AppError) {
        throw error;
      }
      throw new AppError(
        `${errorMessage}: ${
          error instanceof Error ? error.message : String(error)
        }`,
        error instanceof AppError ? error.statusCode : 500
      );
    } finally {
      await session.close();
    }
  }

  /**
   * Performs a database operation within a transaction and handles errors
   * @param operation Function that performs the transaction operations
   * @returns Result of the operation
   * @throws AppError if the operation fails
   */
  private async executeInTransaction<T>(
    operation: (tx: any) => Promise<T>,
    errorMessage: string = 'Transaction operation failed'
  ): Promise<T> {
    return this.executeDbOperation(async (session) => {
      const tx = session.beginTransaction();
      try {
        const result = await operation(tx);
        await tx.commit();
        return result;
      } catch (error) {
        await tx.rollback();
        throw error;
      }
    }, errorMessage);
  }

  /**
   * Extracts user data from a Neo4j record
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
   * Formats user data from Neo4j record including address and payment methods
   * @param record Object containing user node, address node, and payment methods
   * @returns Formatted IUser object
   */
  private formatUserFromRecord({ user, address, paymentMethods }: any): IUser {
    const userProps = user.properties || user;
    let addressObj = undefined;
    if (address && address.properties) {
      addressObj = {
        street: address.properties.street || undefined,
        city: address.properties.city || undefined,
        state: address.properties.state || undefined,
        postalCode: address.properties.postalCode || undefined,
        country: address.properties.country || undefined,
      };
    }

    let paymentMethodsArr = undefined;
    if (paymentMethods && paymentMethods.length > 0) {
      paymentMethodsArr = paymentMethods
        .map((pm: any) =>
          pm && pm.properties
            ? { id: pm.properties.id, type: pm.properties.type }
            : null
        )
        .filter((pm: any) => pm !== null);
      if (paymentMethodsArr.length === 0) paymentMethodsArr = undefined;
    }

    return {
      id: userProps.id,
      firstName: userProps.firstName,
      lastName: userProps.lastName,
      email: userProps.email,
      phone: userProps.phone || undefined,
      address: addressObj,
      paymentMethods: paymentMethodsArr,
      createdAt: userProps.createdAt,
      updatedAt: userProps.updatedAt,
    };
  }

  /**
   * Creates shared attribute relationships between users
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
   * Creates related entities for a user (Address, PaymentMethod)
   * @param userId ID of the user
   * @param userData User data containing related information
   * @param tx Active Neo4j transaction
   */
  private async createRelatedEntities(
    userId: string,
    userData: Partial<IUser>,
    tx: any
  ): Promise<void> {
    // Create Address
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
          userId,
          street: userData.address?.street || null,
          city: userData.address?.city || null,
          state: userData.address?.state || null,
          postalCode: userData.address?.postalCode || null,
          country: userData.address?.country || null,
        }
      );
    }

    // Create Payment Methods
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
            userId,
            paymentId: paymentMethod.id,
            paymentType: paymentMethod.type,
          }
        );
      }
    }
  }

  /**
   * Updates an existing user with new data
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

    // Delete existing related entities
    await tx.run(
      `
      MATCH (u:User {id: $userId})-[r:HAS_ADDRESS]->(a:Address)
      DELETE r, a
      `,
      { userId }
    );

    await tx.run(
      `
      MATCH (u:User {id: $userId})-[r:HAS_PAYMENT_METHOD]->(p:PaymentMethod)
      DELETE r, p
      `,
      { userId }
    );

    // Delete existing shared relationships
    await tx.run(
      `
      MATCH (u:User {id: $userId})-[r:SHARED_EMAIL|SHARED_PHONE|SHARED_ADDRESS|SHARED_PAYMENT_METHOD]->()
      DELETE r
      `,
      { userId }
    );

    // Create new related entities
    await this.createRelatedEntities(userId, userData, tx);

    // Recreate shared relationships
    await this.createSharedRelationships(userId, userData, tx);

    return updatedUser;
  }

  /**
   * Upserts a user (updates if ID is provided, otherwise creates new)
   * @param userData User data (may include id for updates)
   * @returns Object containing the user data and whether it was newly created
   */
  async upsert(
    userData: Partial<IUser>
  ): Promise<{ user: IUser; isNew: boolean }> {
    return this.executeInTransaction(async (tx) => {
      const now = new Date().toISOString();

      // Handle updates by ID
      if (userData.id) {
        const existingResult = await tx.run(
          `
          MATCH (u:User {id: $id})
          RETURN u
          `,
          { id: userData.id }
        );

        if (existingResult.records.length > 0) {
          const updatedUser = await this.updateExistingUser(
            userData.id,
            userData,
            tx,
            now
          );
          return { user: updatedUser, isNew: false };
        } else {
          throw new AppError(`User with ID ${userData.id} not found`, 404);
        }
      }

      // Create new user
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

      // Create related entities and relationships
      await this.createRelatedEntities(user.id, userData, tx);
      await this.createSharedRelationships(user.id, userData, tx);

      return { user, isNew: true };
    }, 'Error while upserting user');
  }

  /**
   * Retrieves all users from the database with their associated address and payment details
   * @param offset Number of users to skip (default: 0)
   * @param limit Number of users to fetch (default: 30)
   * @returns Object containing an array of users and pagination metadata
   */
  async getAllUsers(
    offset = 0,
    limit = 30
  ): Promise<{ users: IUser[]; pagination: any }> {
    return this.executeDbOperation(async (session) => {
      const countResult = await session.run(
        'MATCH (u:User) RETURN COUNT(u) AS total'
      );
      const totalValue = countResult.records[0].get('total');
      const totalUsers = neo4j.isInt(totalValue)
        ? totalValue.toNumber()
        : totalValue;
      const totalPages = Math.ceil(totalUsers / limit);

      const result = await session.run(
        `
        MATCH (u:User)
        OPTIONAL MATCH (u)-[:HAS_ADDRESS]->(a:Address)
        OPTIONAL MATCH (u)-[:HAS_PAYMENT_METHOD]->(p:PaymentMethod)
        RETURN u, a, COLLECT(DISTINCT p) AS paymentMethods
        ORDER BY u.createdAt DESC
        SKIP $offset
        LIMIT $limit
        `,
        { offset: neo4j.int(offset), limit: neo4j.int(limit) }
      );

      const users = result.records.map((record: any) =>
        this.formatUserFromRecord({
          user: record.get('u'),
          address: record.get('a'),
          paymentMethods: record.get('paymentMethods') || [],
        })
      );

      return {
        users,
        pagination: {
          currentPage: Math.floor(offset / limit) + 1,
          totalPages,
          totalUsers,
          hasNextPage: offset / limit + 1 < totalPages,
          hasPreviousPage: offset / limit + 1 > 1,
        },
      };
    }, 'Failed to fetch users');
  }

  /**
   * Finds a user by email address
   * @param email Email address to search for
   * @returns User object if found, null otherwise
   */
  async findByEmail(email: string): Promise<IUser | null> {
    return this.executeDbOperation(async (session) => {
      const result = await session.run(
        'MATCH (u:User {email: $email}) RETURN u',
        { email }
      );

      if (result.records.length === 0) {
        return null;
      }

      return this.extractUserFromRecord(result);
    }, 'Failed to find user by email');
  }

  /**
   * Formats transaction properties from Neo4j nodes
   * @param txNode Transaction node
   * @param deviceInfoNode DeviceInfo node (optional)
   * @param geolocationNode Geolocation node (optional)
   * @param paymentTypeNode PaymentType node (optional)
   * @returns Formatted ITransaction object
   */
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

    // Fixed typo: 'atate' to 'state'
    if (geolocationNode?.properties?.state) {
      geolocationContent.state = geolocationNode.properties.state as string;
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

  /**
   * Retrieves all connections for a given user
   * @param userId The ID of the user whose connections are to be fetched
   * @returns An object containing lists of direct relationships, sent transactions, and received transactions
   */
  async getUserConnections(userId: string): Promise<IUserConnections> {
    return this.executeDbOperation(async (session) => {
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

      // Fetch shared transaction relationships
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
    }, 'Error while fetching user connections');
  }

  /**
   * Returns true if any address field is needed for search or filter
   */
  private needsAddressRelationship(
    searchText?: string,
    filters: any = {}
  ): boolean {
    if (searchText) return true;
    return !!(
      filters.city ||
      filters.state ||
      filters.country ||
      filters.postalCode
    );
  }

  /**
   * Returns true if payment method type filter is present
   */
  private needsPaymentMethodRelationship(filters: any = {}): boolean {
    return (
      Array.isArray(filters.paymentMethodTypes) &&
      filters.paymentMethodTypes.length > 0
    );
  }

  /**
   * Builds search conditions for Cypher query
   */
  private buildSearchConditions(
    searchText?: string,
    filters: any = {},
    includeAddressFields: boolean = false,
    includePaymentMethodFields: boolean = false
  ): { whereClause: string; parameters: any } {
    const conditions: string[] = [];
    const parameters: any = {};

    // General search text
    if (searchText && searchText.trim()) {
      const searchFields = [
        'u.firstName',
        'u.lastName',
        'u.email',
        'u.phone',
        ...(includeAddressFields
          ? ['a.city', 'a.state', 'a.country', 'a.postalCode']
          : []),
      ];
      const searchConditions = searchFields.map((field, i) => {
        const paramName = `searchText${i}`;
        parameters[paramName] = `(?i).*${searchText.trim()}.*`;
        return `${field} =~ $${paramName}`;
      });
      conditions.push(`(${searchConditions.join(' OR ')})`);
    }

    // Specific filters
    if (filters.firstName) {
      parameters.firstName = `(?i).*${filters.firstName}.*`;
      conditions.push('u.firstName =~ $firstName');
    }
    if (filters.lastName) {
      parameters.lastName = `(?i).*${filters.lastName}.*`;
      conditions.push('u.lastName =~ $lastName');
    }
    if (filters.email) {
      parameters.email = `(?i).*${filters.email}.*`;
      conditions.push('u.email =~ $email');
    }
    if (filters.phone) {
      parameters.phone = filters.phone;
      conditions.push('u.phone STARTS WITH $phone');
    }
    if (includeAddressFields) {
      if (filters.city) {
        parameters.city = filters.city;
        conditions.push('a IS NOT NULL AND toLower(a.city) = toLower($city)');
      }
      if (filters.state) {
        parameters.state = filters.state;
        conditions.push('a IS NOT NULL AND toLower(a.state) = toLower($state)');
      }
      if (filters.country) {
        parameters.country = filters.country;
        conditions.push(
          'a IS NOT NULL AND toLower(a.country) = toLower($country)'
        );
      }
      if (filters.postalCode) {
        parameters.postalCode = filters.postalCode;
        conditions.push('a IS NOT NULL AND a.postalCode = $postalCode');
      }
    }
    if (
      includePaymentMethodFields &&
      filters.paymentMethodTypes &&
      filters.paymentMethodTypes.length > 0
    ) {
      parameters.paymentMethodTypes = filters.paymentMethodTypes;
      conditions.push('pm IS NOT NULL AND pm.type IN $paymentMethodTypes');
    }
    if (filters.createdAfter) {
      parameters.createdAfter = filters.createdAfter;
      conditions.push('u.createdAt >= $createdAfter');
    }
    if (filters.createdBefore) {
      parameters.createdBefore = filters.createdBefore;
      conditions.push('u.createdAt <= $createdBefore');
    }
    if (filters.updatedAfter) {
      parameters.updatedAfter = filters.updatedAfter;
      conditions.push('u.updatedAt >= $updatedAfter');
    }
    if (filters.updatedBefore) {
      parameters.updatedBefore = filters.updatedBefore;
      conditions.push('u.updatedAt <= $updatedBefore');
    }

    const whereClause =
      conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : '';
    return { whereClause, parameters };
  }

  /**
   * Searches for users based on various criteria and returns full user details
   * @param query IUserSearchQuery
   * @returns IUserSearchResult with pagination metadata
   */
  async searchUsers(query: IUserSearchQuery): Promise<IUserSearchResult> {
    return this.executeDbOperation(async (session) => {
      const { searchText, page, limit, sortBy, sortOrder, filters } = query;
      const offset = (page - 1) * limit;

      const needsAddress = this.needsAddressRelationship(searchText, filters);
      const needsPaymentMethods = this.needsPaymentMethodRelationship(filters);

      const searchConditions = this.buildSearchConditions(
        searchText,
        filters,
        needsAddress,
        needsPaymentMethods
      );

      let baseQuery = 'MATCH (u:User)';
      if (
        needsAddress &&
        (filters.city || filters.state || filters.country || filters.postalCode)
      ) {
        baseQuery += '\nMATCH (u)-[:HAS_ADDRESS]->(a:Address)';
      } else if (needsAddress) {
        baseQuery += '\nOPTIONAL MATCH (u)-[:HAS_ADDRESS]->(a:Address)';
      }
      if (needsPaymentMethods) {
        baseQuery += '\nMATCH (u)-[:HAS_PAYMENT_METHOD]->(pm:PaymentMethod)';
      }

      const countQuery = `
        ${baseQuery}
        ${searchConditions.whereClause}
        RETURN COUNT(DISTINCT u) AS total
      `;
      const countResult = await session.run(
        countQuery,
        searchConditions.parameters
      );
      const totalValue = countResult.records[0].get('total');
      const totalUsers = neo4j.isInt(totalValue)
        ? totalValue.toNumber()
        : totalValue;

      const sortClause = `ORDER BY u.${sortBy} ${sortOrder.toUpperCase()}`;
      const searchParams = {
        ...searchConditions.parameters,
        offset: neo4j.int(offset),
        limit: neo4j.int(limit),
      };
      const searchQuery = `
        ${baseQuery}
        ${searchConditions.whereClause}
        WITH DISTINCT u
        ${sortClause}
        SKIP $offset
        LIMIT $limit
        OPTIONAL MATCH (u)-[:HAS_ADDRESS]->(address_node:Address)
        OPTIONAL MATCH (u)-[:HAS_PAYMENT_METHOD]->(pm_node:PaymentMethod)
        RETURN u, address_node AS address, COLLECT(DISTINCT pm_node) AS paymentMethods
      `;
      const result = await session.run(searchQuery, searchParams);

      const users = result.records.map((record: any) =>
        this.formatUserFromRecord({
          user: record.get('u'),
          address: record.get('address'),
          paymentMethods: record.get('paymentMethods') || [],
        })
      );

      const totalPages = totalUsers > 0 ? Math.ceil(totalUsers / limit) : 1;
      const currentPage = Math.min(page, totalPages);

      return {
        users,
        pagination: {
          currentPage,
          totalPages,
          totalUsers,
          hasNextPage: currentPage < totalPages,
          hasPreviousPage: currentPage > 1,
        },
      };
    }, 'Failed to search users');
  }

  /**
   * Finds the shortest path between two users in the transaction graph
   * @param userId1 ID of the first user
   * @param userId2 ID of the second user
   * @returns ShortestPathResult containing the path and its length
   * @throws AppError if users are not found or no path exists
   */
  async findShortestPathBetweenUsers(
    userId1: string,
    userId2: string
  ): Promise<IShortestPathResult> {
    return this.executeDbOperation(async (session) => {
      // Verify that both users exist
      const userCheckResult = await session.run(
        `
        MATCH (u1:User {id: $userId1})
        MATCH (u2:User {id: $userId2})
        RETURN u1, u2
        `,
        { userId1, userId2 }
      );

      if (userCheckResult.records.length === 0) {
        throw new AppError(
          `One or both users not found: ${userId1}, ${userId2}`,
          404
        );
      }

      // Find the shortest path
      const result = await session.run(
        `
        MATCH (u1:User {id: $userId1})
        MATCH (u2:User {id: $userId2})
        MATCH path = shortestPath((u1)-[:SENT|RECEIVED_BY*]-(u2))
        WHERE u1 <> u2
        WITH path
        UNWIND nodes(path) AS node
        UNWIND relationships(path) AS rel
        RETURN collect(distinct node) AS nodes, collect(distinct rel) AS relationships, length(path) AS pathLength
        `,
        { userId1, userId2 }
      );

      if (result.records.length === 0) {
        throw new AppError(
          `No path exists between users ${userId1} and ${userId2}`,
          404
        );
      }

      const record = result.records[0];
      const nodesRaw = record.get('nodes');
      const nodes = nodesRaw.map((node: any) => ({
        type: node.labels.includes('User') ? 'User' : 'Transaction',
        properties: node.properties,
      }));

      const nodeIdMap: { [key: string]: string } = {};
      nodesRaw.forEach((node: any) => {
        const internalId = neo4j.isInt(node.identity)
          ? node.identity.toString()
          : String(node.identity);
        nodeIdMap[internalId] = node.properties.id;
      });

      const relationshipsRaw = record.get('relationships') || [];
      const relationships = relationshipsRaw
        .filter(
          (rel: any) => rel && rel.start !== undefined && rel.end !== undefined
        )
        .map((rel: any, index: number) => {
          const startInternalId = neo4j.isInt(rel.start)
            ? rel.start.toString()
            : String(rel.start);
          const endInternalId = neo4j.isInt(rel.end)
            ? rel.end.toString()
            : String(rel.end);

          const startNodeId = nodeIdMap[startInternalId];
          const endNodeId = nodeIdMap[endInternalId];

          if (!startNodeId || !endNodeId) {
            return null;
          }

          const expectedStartId = nodes[index].properties.id;
          const expectedEndId = nodes[index + 1].properties.id;

          const startNodeType = nodes[index].type;
          const endNodeType = nodes[index + 1].type;

          let finalStartNodeId = startNodeId;
          let finalEndNodeId = endNodeId;
          let finalType = rel.type;

          const isForward =
            startNodeId === expectedStartId && endNodeId === expectedEndId;
          const isReversed =
            startNodeId === expectedEndId && endNodeId === expectedStartId;

          if (!isForward && !isReversed) {
            return null;
          }

          if (isReversed) {
            finalStartNodeId = endNodeId;
            finalEndNodeId = startNodeId;
            finalType = rel.type === 'SENT' ? 'RECEIVED_BY' : 'SENT';
          }

          if (
            finalType === 'SENT' &&
            (startNodeType !== 'User' || endNodeType !== 'Transaction')
          ) {
            return null;
          }
          if (
            finalType === 'RECEIVED_BY' &&
            (startNodeType !== 'Transaction' || endNodeType !== 'User')
          ) {
            return null;
          }

          return {
            type: finalType,
            startNodeId: finalStartNodeId,
            endNodeId: finalEndNodeId,
          };
        })
        .filter((rel: any) => rel !== null);

      const rawPathLength = record.get('pathLength');
      const pathLength = neo4j.isInt(rawPathLength)
        ? rawPathLength.toNumber()
        : rawPathLength;

      if (relationships.length !== pathLength) {
        throw new AppError(
          `Mismatch between path length (${pathLength}) and number of relationships (${relationships.length})`,
          500
        );
      }

      return {
        path: {
          nodes,
          relationships,
        },
        length: pathLength,
      };
    }, 'Error while finding shortest path');
  }
}

export default new UserModel();
