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
}
