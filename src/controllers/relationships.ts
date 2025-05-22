import { NextFunction, Request, Response } from 'express';
import UserModel from '../models/User';
import { AppError } from '../utils/appError';

export default class RelationshipController {
  public static async getUserRelationships(
    req: Request,
    res: Response,
    next: NextFunction
  ) {
    try {
      const userId = req.params.userId;

      if (!userId) {
        throw new AppError('User ID is required', 400);
      }

      const relationships = await UserModel.getUserConnections(userId);

      return res.status(200).json({
        status: 'success',
        data: relationships,
      });
    } catch (error) {
      if (error instanceof AppError) {
        return res.status(error.statusCode).json({
          status: 'error',
          message: error.message,
        });
      }
      console.error('Error in getUserRelationships:', error);
      next(error);
    }
  }
}
