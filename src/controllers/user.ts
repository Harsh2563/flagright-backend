import { NextFunction, Request, Response } from 'express';
import UserModel from '../models/User';
import { AppError } from '../utils/appError';
import { IUserSearchQuery } from '../interfaces/userSearch';

export default class UserController {
  public static async handleUser(
    req: Request,
    res: Response,
    next: NextFunction
  ) {
    try {
      const userData = req.body;

      const result = await UserModel.upsert(userData);
      const { user, isNew } = result;

      return res.status(isNew ? 201 : 200).json({
        status: 'success',
        message: isNew
          ? 'User created successfully'
          : 'User updated successfully',
        data: { user },
      });
    } catch (error) {
      if (error instanceof AppError) {
        return res.status(error.statusCode).json({
          status: 'error',
          message: error.message,
        });
      }
      console.error('Error in handleUser:', error);
      next(error);
    }
  }

  public static async getAllUsers(
    req: Request,
    res: Response,
    next: NextFunction
  ) {
    try {
      // Pagination support
      const page = Math.max(Number(req.query.page) || 1, 1);
      const limit = Math.max(Number(req.query.limit) || 10, 1);
      const offset = (page - 1) * limit;
      const {users, pagination} = await UserModel.getAllUsers(offset, limit);

      return res.status(200).json({
        status: 'success',
        results: users.length,
        data: {
          users,
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
      console.error('Error in getAllUsers:', error);
      next(error);
    }
  }
  public static async searchUsers(
    req: Request,
    res: Response,
    next: NextFunction
  ): Promise<void> {
    try {
      // Use the validated query from the middleware
      const searchQuery: IUserSearchQuery =
        (req as any).validatedQuery || req.query;

      const result = await UserModel.searchUsers(searchQuery);

      res.status(200).json({
        status: 'success',
        message: 'Users retrieved successfully',
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
      console.error('Error in searchUsers:', error);
      next(error);
    }
  }
}
