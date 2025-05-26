import { RequestHandler, Router } from 'express';
import { validateRequest } from '../middleware/validateRequest';
import {
  TransactionSchema,
  TransactionSearchSchema,
} from '../validators/transaction';
import TransactionController from '../controllers/transaction';
import { validateSearchQuery } from '../middleware/validateSearchQuery';

const router = Router();

router.post(
  '/',
  validateRequest(TransactionSchema),
  TransactionController.handleTransaction as RequestHandler
);
router.get('/', TransactionController.getAllTransactions as RequestHandler);
router.get(
  '/search',
  validateSearchQuery(TransactionSearchSchema),
  TransactionController.searchTransactions as RequestHandler
);

export default router;
