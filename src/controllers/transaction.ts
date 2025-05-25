import { NextFunction, Request, Response } from 'express';
import TransactionModel from '../models/Transaction';
import { AppError } from '../utils/appError';

export default class TransactionController {
  public static async handleTransaction(
    req: Request,
    res: Response,
    next: NextFunction
  ) {
    try {
      const transactionData = req.body;

      const result = await TransactionModel.upsert(transactionData);
      const { transaction, isNew } = result;

      return res.status(isNew ? 201 : 200).json({
        status: 'success',
        message: isNew
          ? 'Transaction created successfully'
          : 'Transaction updated successfully',
        data: { transaction },
      });
    } catch (error) {
      if (error instanceof AppError) {
        return res.status(error.statusCode).json({
          status: 'error',
          message: error.message,
        });
      }
      console.error('Error in handleTransaction:', error);
      next(error);
    }
  }

  public static async getAllTransactions(
    req: Request,
    res: Response,
    next: NextFunction
  ) {
    try {
      // Pagination support
      const page = Math.max(Number(req.query.page) || 1, 1);
      const limit = Math.max(Number(req.query.limit) || 10, 1);
      const offset = (page - 1) * limit;
      // Fetch paginated transactions and pagination info
      const { transactions, pagination } =
        await TransactionModel.getAllTransactions(offset, limit);
      return res.status(200).json({
        status: 'success',
        results: transactions.length,
        data: {
          transactions,
          pagination,
        },
      });
    } catch (error) {
      if (error instanceof AppError) {
        return res.status(error.statusCode).json({
          status: 'error',
          message: error.message,
        });
      }
      console.error('Error in getAllTransactions:', error);
      next(error);
    }
  }

  public static async searchTransactions(
    req: Request,
    res: Response,
    next: NextFunction
  ) {
    try {
      const searchQuery = (req as any).validatedQuery || req.query;
      console.log('Search Query:', searchQuery);

      const result = await TransactionModel.searchTransactions(searchQuery);
      res.status(200).json({
        status: 'success',
        message: 'Transactions retrieved successfully',
        data: result,
      });
    } catch (error) {
      if (error instanceof AppError) {
        res.status(error.statusCode).json({
          status: 'error',
          message: error.message,
        });
        return;
      }
      console.error('Error in searchTransactions:', error);
      next(error);
    }
  }
}
