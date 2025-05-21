import neo4j from 'neo4j-driver';
import Neo4jService from '../services/neo4j.service';
import { ITransaction } from '../interfaces/transaction';
import { AppError } from '../utils/appError';

class TransactionModel {
  async create(
    transactionData: Omit<ITransaction, 'id'>
  ): Promise<ITransaction> {
    const session = Neo4jService.getSession();

    try {
      // Validate required fields
      if (!transactionData.senderId) {
        throw new AppError('Sender ID is required', 400);
      }
      if (!transactionData.receiverId) {
        throw new AppError('Receiver ID is required', 400);
      }
      if (!transactionData.amount || transactionData.amount <= 0) {
        throw new AppError('Valid amount is required', 400);
      }
      if (!transactionData.currency) {
        throw new AppError('Currency is required', 400);
      }
      // Verify that both sender and receiver exist
      const senderResult = await session.executeRead((tx: any) =>
        tx.run('MATCH (u:User {id: $id}) RETURN u', {
          id: transactionData.senderId,
        })
      );

      const receiverResult = await session.executeRead((tx: any) =>
        tx.run('MATCH (u:User {id: $id}) RETURN u', {
          id: transactionData.receiverId,
        })
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

      // Create the transaction
      const result = await session.executeWrite((tx: any) =>
        tx.run(
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
        )
      );

      const transaction = this.extractTransactionFromRecord(result);

      // Add device info if provided
      if (transactionData.deviceInfo) {
        await session.executeWrite((tx: any) =>
          tx.run(
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
              transactionId: transaction.id,
              ipAddress: transactionData.deviceInfo?.ipAddress || null,
              country: transactionData.deviceInfo?.geolocation?.country || null,
              city: transactionData.deviceInfo?.geolocation?.city || null,
            }
          )
        );
      }

      // Add payment type if provided
      if (transactionData.paymentType) {
        await session.executeWrite((tx: any) =>
          tx.run(
            `
            MATCH (t:Transaction {id: $transactionId})
            CREATE (p:PaymentType {
              id: $paymentId,
              type: $paymentType
            })
            CREATE (t)-[:USED_PAYMENT]->(p)
            `,
            {
              transactionId: transaction.id,
              paymentId: transactionData.paymentType?.id || null,
              paymentType: transactionData.paymentType?.type || null,
            }
          )
        );
      }

      return transaction;
    } finally {
      await session.close();
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

  /**
   * Find a transaction by its ID
   */
  async findById(id: string): Promise<ITransaction> {
    const session = Neo4jService.getSession();

    try {
      const result = await session.executeRead((tx: any) =>
        tx.run(
          `
          MATCH (sender:User)-[:SENT]->(t:Transaction {id: $id})-[:RECEIVED_BY]->(receiver:User)
          RETURN t, sender, receiver
        `,
          { id }
        )
      );

      if (result.records.length === 0) {
        throw new AppError(`Transaction with ID ${id} not found`, 404);
      }

      return this.extractTransactionFromRecord(result);
    } finally {
      await session.close();
    }
  }
}

export default new TransactionModel();
