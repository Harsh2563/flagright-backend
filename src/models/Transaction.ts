import neo4j from 'neo4j-driver';
import Neo4jService from '../services/neo4j.service';
import { ITransaction } from '../interfaces/transaction';
import { AppError } from '../utils/appError';

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

        //check if sender and receiver are the same
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
   */ private async updateExistingTransaction(
    transactionId: string,
    transactionData: Partial<ITransaction>,
    tx: any
  ): Promise<ITransaction> {
    // Update transaction properties
    const updateResult = await tx.run(
      `
      MATCH (t:Transaction {id: $transactionId})
      SET t.status = $status,
          t.destinationAmount = $destinationAmount,
          t.destinationCurrency = $destinationCurrency,
          t.description = $description
      WITH t
      MATCH (sender:User {id: $senderId})
      MATCH (receiver:User {id: $receiverId})
      RETURN t, sender, receiver
      `,
      {
        transactionId,
        status: transactionData.status,
        destinationAmount: transactionData.destinationAmount || null,
        destinationCurrency: transactionData.destinationCurrency || null,
        description: transactionData.description || null,
        senderId: transactionData.senderId,
        receiverId: transactionData.receiverId,
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
      MATCH (t:Transaction {id: $transactionId})-[r:SHARED_IP|SHARED_DEVICE]->()
      DELETE r
      `,
      { transactionId }
    );

    // Create related entities and establish relationships
    await this.createRelatedEntities(transactionId, transactionData, tx);

    // Create shared relationships based on common attributes
    await this.createSharedRelationships(transactionId, transactionData, tx);

    return updatedTransaction;
  }

  /**
   * Creates related entities for a transaction (DeviceInfo, Geolocation, PaymentType)
   *
   * @param transactionId ID of the transaction
   * @param transactionData Transaction data containing related information
   * @param tx Active Neo4j transaction
   */ private async createRelatedEntities(
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
          city: $city
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
          city: transactionData.deviceInfo?.geolocation?.city || null,
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
   * - IP addresses
   * - Device IDs
   *
   * @param transactionId ID of the transaction to create relationships for
   * @param transactionData Transaction data containing attributes to check for sharing
   * @param tx Active Neo4j transaction
   */ private async createSharedRelationships(
    transactionId: string,
    transactionData: Partial<ITransaction>,
    tx: any
  ): Promise<void> {
    // Shared IP Address
    if (transactionData.deviceInfo?.ipAddress) {
      await tx.run(
        `
        MATCH (t1:Transaction {id: $transactionId})-[:FROM_DEVICE]->(d1:DeviceInfo)
        MATCH (t2:Transaction)-[:FROM_DEVICE]->(d2:DeviceInfo)
        WHERE d2.ipAddress = $ipAddress AND t2.id <> $transactionId
        CREATE (t1)-[:SHARED_IP]->(t2)
        `,
        { transactionId, ipAddress: transactionData.deviceInfo.ipAddress }
      );
    }

    // Shared Device ID
    if (transactionData.deviceId) {
      await tx.run(
        `
        MATCH (t1:Transaction {id: $transactionId})
        MATCH (t2:Transaction)
        WHERE t2.deviceId = $deviceId AND t2.id <> $transactionId
        CREATE (t1)-[:SHARED_DEVICE]->(t2)
        `,
        { transactionId, deviceId: transactionData.deviceId }
      );
    }
  }

  /**
   * Helper method to extract a basic transaction from a Neo4j record
   */ private extractTransactionFromRecord(result: any): ITransaction {
    const record = result.records[0];
    const txProps = record.get('t').properties;
    const senderId = record.get('sender').properties.id;
    const receiverId = record.get('receiver').properties.id;

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
}

export default new TransactionModel();
