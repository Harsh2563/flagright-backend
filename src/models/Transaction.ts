import neo4j from 'neo4j-driver';
import Neo4jService from '../services/neo4j.service';
import { ITransaction } from '../interfaces/transaction';
import { AppError } from '../utils/appError';
import { ITransactionConnections } from '../interfaces/relationship';
import {
  ITransactionSearchQuery,
  ITransactionSearchResult,
} from '../interfaces/transactionSearch';

class TransactionModel {
  /**
   * Upserts a transaction (updates if ID is provided, otherwise creates new)
   *
   * This method will:
   * 1. If ID is provided: Update the existing transaction with that ID
   * 2. If no ID: Create a new transaction
   *
   * For both cases, it will also handle related entities:
   * - Device info and geolocation
   * - Payment method
   * - Shared relationships (IP address, device ID)
   *
   * @param transactionData Transaction data (may include id for updates)
   * @returns Object containing the transaction data and whether it was newly created
   */
  async upsert(
    transactionData: Partial<ITransaction>
  ): Promise<{ transaction: ITransaction; isNew: boolean }> {
    const session = Neo4jService.getSession();

    try {
      // Start a transaction
      const tx = session.beginTransaction();
      try {
        // Handle updates by ID only
        if (transactionData.id) {
          const existingResult = await tx.run(
            `
            MATCH (t:Transaction {id: $id})
            RETURN t
            `,
            { id: transactionData.id }
          );

          if (existingResult.records.length > 0) {
            // Transaction with provided ID exists - update it
            const updatedTransaction = await this.updateExistingTransaction(
              transactionData.id,
              transactionData,
              tx
            );
            await tx.commit();
            return { transaction: updatedTransaction, isNew: false };
          } else {
            throw new AppError(
              `Transaction with ID ${transactionData.id} not found`,
              404
            );
          }
        }

        // Verify that both sender and receiver exist
        const senderResult = await tx.run('MATCH (u:User {id: $id}) RETURN u', {
          id: transactionData.senderId,
        });

        const receiverResult = await tx.run(
          'MATCH (u:User {id: $id}) RETURN u',
          { id: transactionData.receiverId }
        );

        if (senderResult.records.length === 0) {
          throw new AppError(
            `Sender with ID ${transactionData.senderId} not found`,
            404
          );
        }

        if (receiverResult.records.length === 0) {
          throw new AppError(
            `Receiver with ID ${transactionData.receiverId} not found`,
            404
          );
        }

        // Check if sender and receiver are the same
        if (transactionData.senderId === transactionData.receiverId) {
          throw new AppError(
            `Sender and receiver cannot be the same user`,
            400
          );
        }

        // Create the transaction
        const result = await tx.run(
          `
          MATCH (sender:User {id: $senderId})
          MATCH (receiver:User {id: $receiverId})
          CREATE (t:Transaction {
            id: randomUUID(),
            transactionType: $transactionType,
            status: $status,
            senderId: $senderId,
            receiverId: $receiverId,
            amount: $amount,
            currency: $currency,
            destinationAmount: $destinationAmount,
            destinationCurrency: $destinationCurrency,
            timestamp: $timestamp,
            description: $description,
            deviceId: $deviceId
          })
          CREATE (sender)-[:SENT]->(t)
          CREATE (t)-[:RECEIVED_BY]->(receiver)
          RETURN t, sender, receiver
          `,
          {
            senderId: transactionData.senderId,
            receiverId: transactionData.receiverId,
            transactionType: transactionData.transactionType,
            status: transactionData.status,
            amount: transactionData.amount,
            currency: transactionData.currency,
            destinationAmount: transactionData.destinationAmount || null,
            destinationCurrency: transactionData.destinationCurrency || null,
            timestamp: transactionData.timestamp,
            description: transactionData.description || null,
            deviceId: transactionData.deviceId || null,
          }
        );

        const transaction = this.extractTransactionFromRecord(result);

        // Create related entities and establish relationships
        await this.createRelatedEntities(transaction.id, transactionData, tx);

        // Create shared relationships based on common attributes
        await this.createSharedRelationships(
          transaction.id,
          transactionData,
          tx
        );

        const deviceInfo = await this.getTransactionDeviceInfo(
          transaction.id,
          tx
        );
        if (deviceInfo) {
          transaction.deviceInfo = deviceInfo;
        }

        await tx.commit();
        return { transaction, isNew: true };
      } catch (error) {
        await tx.rollback();
        throw new AppError(
          'Error while upserting transaction: ' +
            (error instanceof Error ? error.message : String(error))
        );
      }
    } finally {
      await session.close();
    }
  }

  /**
   * Updates an existing transaction with new data
   *
   * @param transactionId ID of the existing transaction to update
   * @param transactionData New transaction data to apply
   * @param tx Active Neo4j transaction
   * @returns Updated transaction data
   */
  private async updateExistingTransaction(
    transactionId: string,
    transactionData: Partial<ITransaction>,
    tx: any
  ): Promise<ITransaction> {
    if (transactionData.senderId) {
      const senderResult = await tx.run('MATCH (u:User {id: $id}) RETURN u', {
        id: transactionData.senderId,
      });
      if (senderResult.records.length === 0) {
        throw new AppError(
          `Sender with ID ${transactionData.senderId} not found`,
          404
        );
      }
    }

    if (transactionData.receiverId) {
      const receiverResult = await tx.run('MATCH (u:User {id: $id}) RETURN u', {
        id: transactionData.receiverId,
      });
      if (receiverResult.records.length === 0) {
        throw new AppError(
          `Receiver with ID ${transactionData.receiverId} not found`,
          404
        );
      }
    }

    // Check if sender and receiver are the same, if both are provided
    if (
      transactionData.senderId &&
      transactionData.receiverId &&
      transactionData.senderId === transactionData.receiverId
    ) {
      throw new AppError(`Sender and receiver cannot be the same user`, 400);
    }

    if (transactionData.senderId || transactionData.receiverId) {
      await tx.run(
        `
        MATCH (t:Transaction {id: $transactionId})-[r:SENT|RECEIVED_BY]-()
        DELETE r
        `,
        { transactionId }
      );

      // Create new relationships
      await tx.run(
        `
        MATCH (t:Transaction {id: $transactionId})
        MATCH (sender:User {id: $senderId})
        MATCH (receiver:User {id: $receiverId})
        CREATE (sender)-[:SENT]->(t)
        CREATE (t)-[:RECEIVED_BY]->(receiver)
        `,
        {
          transactionId,
          senderId:
            transactionData.senderId ||
            (await this.getCurrentSenderId(transactionId, tx)),
          receiverId:
            transactionData.receiverId ||
            (await this.getCurrentReceiverId(transactionId, tx)),
        }
      );
    }

    const updateResult = await tx.run(
      `
      MATCH (t:Transaction {id: $transactionId})
      SET t.transactionType = $transactionType,
          t.status = $status,
          t.senderId = $senderId,
          t.receiverId = $receiverId,
          t.amount = $amount,
          t.currency = $currency,
          t.destinationAmount = $destinationAmount,
          t.destinationCurrency = $destinationCurrency,
          t.timestamp = $timestamp,
          t.description = $description,
          t.deviceId = $deviceId
      RETURN t
      `,
      {
        transactionId,
        transactionType: transactionData.transactionType ?? null,
        status: transactionData.status ?? null,
        senderId:
          transactionData.senderId ||
          (await this.getCurrentSenderId(transactionId, tx)),
        receiverId:
          transactionData.receiverId ||
          (await this.getCurrentReceiverId(transactionId, tx)),
        amount: transactionData.amount ?? null,
        currency: transactionData.currency ?? null,
        destinationAmount: transactionData.destinationAmount || null,
        destinationCurrency: transactionData.destinationCurrency || null,
        timestamp: transactionData.timestamp ?? null,
        description: transactionData.description || null,
        deviceId: transactionData.deviceId || null,
      }
    );

    const updatedTransaction = this.extractTransactionFromRecord(updateResult);

    // Delete existing related entities
    await tx.run(
      `
      MATCH (t:Transaction {id: $transactionId})-[r:FROM_DEVICE]->(d:DeviceInfo)
      OPTIONAL MATCH (d)-[r2:LOCATED_AT]->(g:Geolocation)
      DETACH DELETE d, g
      `,
      { transactionId }
    );

    await tx.run(
      `
      MATCH (t:Transaction {id: $transactionId})-[r:USED_PAYMENT]->(p:PaymentType)
      DETACH DELETE p
      `,
      { transactionId }
    );

    // Delete existing shared relationships
    await tx.run(
      `
      MATCH (t:Transaction {id: $transactionId})-[r:SHARED_IP|SHARED_DEVICE]-()
      DELETE r
      `,
      { transactionId }
    );

    // Create related entities and establish relationships
    await this.createRelatedEntities(transactionId, transactionData, tx);

    // Create shared relationships based on common attributes
    await this.createSharedRelationships(transactionId, transactionData, tx);

    const deviceInfo = await this.getTransactionDeviceInfo(transactionId, tx);
    if (deviceInfo) {
      updatedTransaction.deviceInfo = deviceInfo;
    }

    return updatedTransaction;
  }

  /**
   * Helper method to get the current senderId of a transaction
   */
  private async getCurrentSenderId(
    transactionId: string,
    tx: any
  ): Promise<string> {
    const result = await tx.run(
      `
      MATCH (t:Transaction {id: $transactionId})
      RETURN t.senderId AS senderId
      `,
      { transactionId }
    );
    if (result.records.length === 0) {
      throw new AppError(`Transaction with ID ${transactionId} not found`, 404);
    }
    return result.records[0].get('senderId');
  }

  /**
   * Helper method to get the current receiverId of a transaction
   */
  private async getCurrentReceiverId(
    transactionId: string,
    tx: any
  ): Promise<string> {
    const result = await tx.run(
      `
      MATCH (t:Transaction {id: $transactionId})
      RETURN t.receiverId AS receiverId
      `,
      { transactionId }
    );
    if (result.records.length === 0) {
      throw new AppError(`Transaction with ID ${transactionId} not found`, 404);
    }
    return result.records[0].get('receiverId');
  }

  /**
   * Creates related entities for a transaction (DeviceInfo, Geolocation, PaymentType)
   *
   * @param transactionId ID of the transaction
   * @param transactionData Transaction data containing related information
   * @param tx Active Neo4j transaction
   */
  private async createRelatedEntities(
    transactionId: string,
    transactionData: Partial<ITransaction>,
    tx: any
  ): Promise<void> {
    // Add device info if provided
    if (transactionData.deviceInfo) {
      await tx.run(
        `
        MATCH (t:Transaction {id: $transactionId})
        CREATE (d:DeviceInfo {
          ipAddress: $ipAddress
        })
        CREATE (t)-[:FROM_DEVICE]->(d)
        ${
          transactionData.deviceInfo?.geolocation
            ? `
        CREATE (g:Geolocation {
          country: $country,
          state: $state
        })
        CREATE (d)-[:LOCATED_AT]->(g)
        `
            : ''
        }
        `,
        {
          transactionId,
          ipAddress: transactionData.deviceInfo?.ipAddress || null,
          country: transactionData.deviceInfo?.geolocation?.country || null,
          state: transactionData.deviceInfo?.geolocation?.state || null,
        }
      );
    }

    // Add payment method if provided
    if (transactionData.paymentMethod) {
      await tx.run(
        `
        MATCH (t:Transaction {id: $transactionId})
        CREATE (p:PaymentType {
          type: $paymentType
        })
        CREATE (t)-[:USED_PAYMENT]->(p)
        `,
        {
          transactionId,
          paymentType: transactionData.paymentMethod,
        }
      );
    }
  }

  /**
   * Creates shared relationships between transactions with common attributes
   *
   * This helper method establishes relationships between transactions that share:
   * - IP addresses (bidirectional)
   * - Device IDs (bidirectional)
   *
   * @param transactionId ID of the transaction to create relationships for
   * @param transactionData Transaction data containing attributes to check for sharing
   * @param tx Active Neo4j transaction
   */
  private async createSharedRelationships(
    transactionId: string,
    transactionData: Partial<ITransaction>,
    tx: any
  ): Promise<void> {
    // Shared IP Address (bidirectional)
    if (transactionData.deviceInfo?.ipAddress) {
      await tx.run(
        `
        MATCH (t1:Transaction {id: $transactionId})-[:FROM_DEVICE]->(d1:DeviceInfo)
        MATCH (t2:Transaction)-[:FROM_DEVICE]->(d2:DeviceInfo)
        WHERE d2.ipAddress = $ipAddress AND t2.id <> $transactionId
        MERGE (t1)-[:SHARED_IP]-(t2)
        `,
        { transactionId, ipAddress: transactionData.deviceInfo.ipAddress }
      );
    }

    // Shared Device ID (bidirectional)
    if (transactionData.deviceId) {
      await tx.run(
        `
        MATCH (t1:Transaction {id: $transactionId})
        MATCH (t2:Transaction)
        WHERE t2.deviceId = $deviceId AND t2.id <> $transactionId
        MERGE (t1)-[:SHARED_DEVICE]-(t2)
        `,
        { transactionId, deviceId: transactionData.deviceId }
      );
    }
  }

  /**
   * Helper method to extract a basic transaction from a Neo4j record and fetch related device info
   */
  private extractTransactionFromRecord(result: any): ITransaction {
    const record = result.records[0];
    const txProps = record.get('t').properties;
    // Get sender and receiver IDs from the transaction properties
    const senderId = txProps.senderId;
    const receiverId = txProps.receiverId;

    return {
      id: txProps.id,
      transactionType: txProps.transactionType,
      status: txProps.status,
      senderId,
      receiverId,
      amount: neo4j.isInt(txProps.amount)
        ? txProps.amount.toNumber()
        : txProps.amount,
      currency: txProps.currency,
      destinationAmount: txProps.destinationAmount
        ? neo4j.isInt(txProps.destinationAmount)
          ? txProps.destinationAmount.toNumber()
          : txProps.destinationAmount
        : undefined,
      destinationCurrency: txProps.destinationCurrency || undefined,
      timestamp: txProps.timestamp,
      description: txProps.description || undefined,
      deviceId: txProps.deviceId || undefined,
    };
  }

  /**
   * Retrieves all transactions from the database with their associated data
   *
   * This method will:
   * 1. Fetch all transactions
   * 2. Include related device info, geolocation and payment method data
   *
   * @returns Array of transaction objects with device and payment information
   */
  async getAllTransactions(
    offset = 0,
    limit = 10
  ): Promise<{ transactions: ITransaction[]; pagination: any }> {
    const session = Neo4jService.getSession();
    try {
      const result = await session.run(
        `
        MATCH (t:Transaction)
        OPTIONAL MATCH (t)-[:USED_PAYMENT]->(p:PaymentType)
        OPTIONAL MATCH (t)-[:FROM_DEVICE]->(d:DeviceInfo)
        OPTIONAL MATCH (d)-[:LOCATED_AT]->(g:Geolocation)
        RETURN t, p, d, g
        ORDER BY t.timestamp DESC
        SKIP $offset
        LIMIT $limit
      `,
        { offset: neo4j.int(offset), limit: neo4j.int(limit) }
      );
      const countResult = await session.run(
        'MATCH (t:Transaction) RETURN COUNT(t) AS total'
      );
      const totalValue = countResult.records[0].get('total');
      const totalTransactions =
        typeof totalValue === 'object' && totalValue.toNumber
          ? totalValue.toNumber()
          : totalValue;
      const totalPages = Math.ceil(totalTransactions / limit);
      const transactions = result.records.map((record) => {
        const t = record.get('t').properties;
        const p = record.get('p')?.properties;
        const d = record.get('d')?.properties;
        const g = record.get('g')?.properties;

        // Build device info object if available
        let deviceInfo: any = undefined;
        if (d) {
          deviceInfo = {
            ipAddress: d.ipAddress,
          };

          if (g) {
            deviceInfo.geolocation = {
              country: g.country,
              state: g.state,
            };
          }
        }

        return {
          ...t,
          amount:
            typeof t.amount === 'object' && t.amount.toNumber
              ? t.amount.toNumber()
              : t.amount,
          destinationAmount:
            t.destinationAmount && t.destinationAmount.toNumber
              ? t.destinationAmount.toNumber()
              : t.destinationAmount,
          paymentMethod: p ? p.type : undefined,
          deviceInfo: deviceInfo,
        };
      });
      return {
        transactions,
        pagination: {
          currentPage: Math.floor(offset / limit) + 1,
          totalPages,
          totalTransactions,
          hasNextPage: offset / limit + 1 < totalPages,
          hasPreviousPage: offset / limit + 1 > 1,
        },
      };
    } finally {
      session.close();
    }
  }

  /**
   * Retrieves all connections for a given transaction.
   * Connections include:
   * - Sender and receiver users
   * - Other transactions that share the same device ID
   * - Other transactions that share the same IP address
   *
   * @param transactionId The ID of the transaction whose connections are to be fetched.
   * @returns An object containing sender, receiver, and related transactions.
   * @throws {AppError} If there is an error during database interaction or transaction not found.
   */
  async getTransactionConnections(
    transactionId: string
  ): Promise<ITransactionConnections> {
    const session = Neo4jService.getSession();
    try {
      // Fetch sender and receiver information
      const usersResult = await session.run(
        `
        MATCH (sender:User)-[:SENT]->(t:Transaction {id: $transactionId})-[:RECEIVED_BY]->(receiver:User)
        RETURN sender { .id, .firstName, .lastName, .email } AS senderData,
               receiver { .id, .firstName, .lastName, .email } AS receiverData
        `,
        { transactionId }
      );

      if (usersResult.records.length === 0) {
        throw new AppError(
          `Unable to find users for transaction ${transactionId}`,
          404
        );
      }

      const senderData = usersResult.records[0].get('senderData');
      const receiverData = usersResult.records[0].get('receiverData');

      // Fetch transactions sharing the same device ID
      const sharedDeviceResult = await session.run(
        `
        MATCH (t1:Transaction {id: $transactionId})
        WHERE t1.deviceId IS NOT NULL
        MATCH (t2:Transaction)-[r:SHARED_DEVICE]-(t1)
        RETURN type(r) as relationshipType, 
               t2 { .id, .transactionType, .status, .amount, .currency, .timestamp, .deviceId } as relatedTransaction
        `,
        { transactionId }
      );

      const sharedDeviceTransactions = sharedDeviceResult.records.map(
        (record) => ({
          relationshipType: record.get('relationshipType'),
          transaction: record.get('relatedTransaction'),
        })
      );

      // Fetch transactions sharing the same IP address
      const sharedIPResult = await session.run(
        `
        MATCH (t1:Transaction {id: $transactionId})-[:FROM_DEVICE]->(d1:DeviceInfo)
        MATCH (t2:Transaction)-[r:SHARED_IP]-(t1)
        RETURN type(r) as relationshipType, 
               t2 { .id, .transactionType, .status, .amount, .currency, .timestamp, .deviceId } as relatedTransaction
        `,
        { transactionId }
      );

      const sharedIPTransactions = sharedIPResult.records.map((record) => ({
        relationshipType: record.get('relationshipType'),
        transaction: record.get('relatedTransaction'),
      }));

      // Return combined results
      return {
        sender: senderData,
        receiver: receiverData,
        sharedDeviceTransactions,
        sharedIPTransactions,
      };
    } catch (error) {
      if (error instanceof AppError) {
        throw error;
      }
      console.error('Error in getTransactionConnections:', error);
      throw new AppError(
        'Error while fetching transaction connections: ' +
          (error instanceof Error ? error.message : String(error)),
        500
      );
    } finally {
      session.close();
    }
  }

  /**
   * Determines if the PaymentMethod relationship is needed based on the query
   */
  private needsPaymentMethodRelationship(filters: any): boolean {
    return !!filters.paymentMethod;
  }

  /**
   * Builds search conditions for the transaction query
   */
  private buildSearchConditions(
    searchText: string | undefined,
    filters: any
  ): { whereClause: string; parameters: any } {
    const conditions: string[] = [];
    const params: any = {};

    // General search text
    if (searchText && searchText.trim()) {
      const searchFields = [
        't.id',
        't.description',
        't.currency',
        't.deviceId',
      ];
      const searchConds = searchFields.map((field, i) => {
        const paramName = `searchText${i}`;
        params[paramName] = `(?i).*${searchText.trim()}.*`;
        return `${field} =~ $${paramName}`;
      });
      conditions.push(`(${searchConds.join(' OR ')})`);
    }

    // Filters
    if (filters.transactionType) {
      params.transactionType = filters.transactionType;
      conditions.push('t.transactionType = $transactionType');
    }
    if (filters.status) {
      params.status = filters.status;
      conditions.push('t.status = $status');
    }
    if (filters.senderId) {
      params.senderId = filters.senderId;
      conditions.push('t.senderId = $senderId');
    }
    if (filters.receiverId) {
      params.receiverId = filters.receiverId;
      conditions.push('t.receiverId = $receiverId');
    }
    if (filters.currency) {
      params.currency = filters.currency;
      conditions.push('t.currency = $currency');
    }
    if (filters.paymentMethod) {
      params.paymentMethod = filters.paymentMethod;
      conditions.push('pt IS NOT NULL AND pt.type = $paymentMethod');
    }
    if (filters.amountMin !== undefined) {
      params.amountMin = neo4j.int(filters.amountMin);
      conditions.push('t.amount >= $amountMin');
    }
    if (filters.amountMax !== undefined) {
      params.amountMax = neo4j.int(filters.amountMax);
      conditions.push('t.amount <= $amountMax');
    }
    if (filters.createdAfter) {
      params.createdAfter = filters.createdAfter;
      conditions.push('t.timestamp >= $createdAfter');
    }
    if (filters.createdBefore) {
      params.createdBefore = filters.createdBefore;
      conditions.push('t.timestamp <= $createdBefore');
    }
    if (filters.description) {
      params.description = `(?i).*${filters.description}.*`;
      conditions.push(
        't.description IS NOT NULL AND t.description =~ $description'
      );
    }

    const whereClause =
      conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : '';
    return { whereClause, parameters: params };
  }

  /**
   * Formats a transaction record from Neo4j into the ITransaction interface
   */
  private formatTransactionFromRecord(record: {
    transaction: any;
    paymentMethods: any[];
  }): ITransaction {
    const { transaction, paymentMethods } = record;
    const props = transaction.properties;
    return {
      id: props.id,
      transactionType: props.transactionType,
      status: props.status,
      senderId: props.senderId,
      receiverId: props.receiverId,
      amount: neo4j.isInt(props.amount)
        ? props.amount.toNumber()
        : props.amount,
      currency: props.currency,
      destinationAmount: props.destinationAmount
        ? neo4j.isInt(props.destinationAmount)
          ? props.destinationAmount.toNumber()
          : props.destinationAmount
        : undefined,
      destinationCurrency: props.destinationCurrency || undefined,
      timestamp: props.timestamp,
      description: props.description || undefined,
      deviceId: props.deviceId || undefined,
      paymentMethod:
        paymentMethods.length > 0
          ? paymentMethods[0].properties.type
          : undefined,
    };
  }

  /**
   * Searches for transactions based on various criteria
   *
   * This method supports filtering by transaction attributes, pagination, and sorting.
   *
   * @param query Search and filter criteria
   * @returns A paginated and sorted list of transactions matching the criteria
   */
  async searchTransactions(
    query: ITransactionSearchQuery
  ): Promise<ITransactionSearchResult> {
    const session = Neo4jService.getSession();
    try {
      const { searchText, page, limit, sortBy, sortOrder, filters } = query;
      const offset = (page - 1) * limit;

      // Map sortBy field (e.g., createdAt to timestamp)
      const mappedSortBy = sortBy === 'createdAt' ? 'timestamp' : sortBy;

      // Determine if we need the PaymentMethod relationship for filtering
      const needsPaymentMethods = this.needsPaymentMethodRelationship(filters);

      // Build search conditions
      const searchConditions = this.buildSearchConditions(searchText, filters);

      // Build the base query with required relationships for filtering
      let baseQuery = 'MATCH (t:Transaction)';
      if (needsPaymentMethods) {
        baseQuery += '\nMATCH (t)-[:USED_PAYMENT]->(pt:PaymentType)';
      }

      // Count query
      const countQuery = `
        ${baseQuery}
        ${searchConditions.whereClause}
        RETURN COUNT(DISTINCT t) AS total
      `;
      const countResult = await session.run(
        countQuery,
        searchConditions.parameters
      );
      const totalValue = countResult.records[0].get('total');
      const totalTransactions = neo4j.isInt(totalValue)
        ? totalValue.toNumber()
        : totalValue;

      // Main search query
      const sortClause = `ORDER BY t.${mappedSortBy} ${sortOrder.toUpperCase()}`;
      const searchParams = {
        ...searchConditions.parameters,
        offset: neo4j.int(offset),
        limit: neo4j.int(limit),
      };
      const searchQuery = `
        ${baseQuery}
        ${searchConditions.whereClause}
        WITH DISTINCT t
        ${sortClause}
        SKIP $offset
        LIMIT $limit
        OPTIONAL MATCH (t)-[:USED_PAYMENT]->(pt_node:PaymentType)
        OPTIONAL MATCH (t)-[:FROM_DEVICE]->(d:DeviceInfo)
        OPTIONAL MATCH (d)-[:LOCATED_AT]->(g:Geolocation)
        RETURN t, COLLECT(DISTINCT pt_node) AS paymentMethods, d, g
      `;
      const result = await session.run(searchQuery, searchParams);
      const transactions = result.records.map((record) => {
        const transactionNode = record.get('t');
        const paymentMethods = record.get('paymentMethods') || [];
        const deviceInfoNode = record.get('d');
        const geolocationNode = record.get('g');

        // Format the transaction
        const transaction = this.formatTransactionFromRecord({
          transaction: transactionNode,
          paymentMethods,
        });

        // Add device info if available
        if (deviceInfoNode) {
          const deviceInfo: any = {
            ipAddress: deviceInfoNode.properties.ipAddress,
          };

          if (geolocationNode) {
            deviceInfo.geolocation = {
              country: geolocationNode.properties.country,
              state: geolocationNode.properties.state,
            };
          }

          transaction.deviceInfo = deviceInfo;
        }

        return transaction;
      });

      const totalPages =
        totalTransactions > 0 ? Math.ceil(totalTransactions / limit) : 1;
      const currentPage = Math.min(page, totalPages);

      return {
        transactions,
        pagination: {
          currentPage,
          totalPages,
          totalTransactions,
          hasNextPage: currentPage < totalPages,
          hasPreviousPage: currentPage > 1,
        },
      };
    } catch (error) {
      throw new AppError(
        'Failed to search transactions: ' +
          (error instanceof Error ? error.message : String(error)),
        500
      );
    } finally {
      await session.close();
    }
  }

  /**
   * Retrieves device info and geolocation for a transaction
   *
   * @param transactionId ID of the transaction
   * @param tx Active Neo4j transaction (optional)
   * @returns Device info object or undefined
   */
  private async getTransactionDeviceInfo(
    transactionId: string,
    tx?: any
  ): Promise<ITransaction['deviceInfo'] | undefined> {
    const session = tx || Neo4jService.getSession();
    const ownSession = !tx;

    try {
      const result = await session.run(
        `
        MATCH (t:Transaction {id: $transactionId})-[:FROM_DEVICE]->(d:DeviceInfo)
        OPTIONAL MATCH (d)-[:LOCATED_AT]->(g:Geolocation)
        RETURN d, g
        `,
        { transactionId }
      );

      if (result.records.length === 0) {
        return undefined;
      }

      const record = result.records[0];
      const deviceInfo = record.get('d')?.properties;
      const geolocation = record.get('g')?.properties;

      if (!deviceInfo) {
        return undefined;
      }

      const deviceInfoObj: ITransaction['deviceInfo'] = {
        ipAddress: deviceInfo.ipAddress,
      };

      if (geolocation) {
        deviceInfoObj.geolocation = {
          country: geolocation.country,
          state: geolocation.state,
        };
      }

      return deviceInfoObj;
    } finally {
      if (ownSession) {
        await session.close();
      }
    }
  }
}

export default new TransactionModel();
