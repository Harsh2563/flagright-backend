import { RequestHandler, Router } from 'express';
import { validateRequest } from '../middleware/validateRequest';
import { TransactionSchema } from '../validators/transaction';
import TransactionController from '../controllers/transaction';

const router = Router();

router.post(
  '/',
  validateRequest(TransactionSchema),
  TransactionController.handleTransaction as RequestHandler
);
router.get('/',  TransactionController.getAllTransactions as RequestHandler);

export default router;

