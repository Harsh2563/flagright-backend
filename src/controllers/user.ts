import { NextFunction, Request, Response } from 'express';
import UserModel from '../models/User';
import { AppError } from '../utils/appError';

export default class UserController {
  public static async createUser(
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
      console.error('Error in createUser:', error);
      next(error);
    }
  }

  public static async getAllUsers(
    req: Request,
    res: Response,
    next: NextFunction
  ) {
    try {
      const users = await UserModel.getAllUsers();

      return res.status(200).json({
        status: 'success',
        results: users.length,
        data: { users },
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
}
