import { z } from 'zod';
import {
  PaymentMethodType,
  TransactionStatus,
  TransactionType,
} from '../types/enums/TransactionEnums';

export const TransactionSearchSchema = z
  .object({
    searchText: z.string().optional(),

    // Pagination
    page: z.coerce.number().int().min(1).optional().default(1),
    limit: z.coerce.number().int().min(1).max(100).optional().default(10),

    // Sorting
    sortBy: z
      .enum([
        'timestamp',
        'amount',
        'status',
        'transactionType',
        'currency',
        'createdAt',
      ])
      .optional()
      .default('timestamp'),
    sortOrder: z.enum(['asc', 'desc']).optional().default('desc'),

    // Transaction filters
    'filters.transactionType': z.nativeEnum(TransactionType).optional(),
    'filters.status': z.nativeEnum(TransactionStatus).optional(),
    'filters.senderId': z.string().optional(),
    'filters.receiverId': z.string().optional(),
    'filters.currency': z.string().optional(),
    'filters.paymentMethod': z.nativeEnum(PaymentMethodType).optional(),
    'filters.amountMin': z.coerce.number().optional(),
    'filters.amountMax': z.coerce.number().optional(),
    'filters.createdAfter': z.string().datetime().optional(),
    'filters.createdBefore': z.string().datetime().optional(),
  })
  .transform((data) => {
    const {
      'filters.transactionType': transactionType,
      'filters.status': status,
      'filters.senderId': senderId,
      'filters.receiverId': receiverId,
      'filters.currency': currency,
      'filters.paymentMethod': paymentMethod,
      'filters.amountMin': amountMin,
      'filters.amountMax': amountMax,
      'filters.createdAfter': createdAfter,
      'filters.createdBefore': createdBefore,
      ...rest
    } = data;
    return {
      ...rest,
      filters: {
        transactionType,
        status,
        senderId,
        receiverId,
        currency,
        paymentMethod,
        amountMin,
        amountMax,
        createdAfter,
        createdBefore,
      },
    };
  });

export type TransactionSearchQuery = z.infer<typeof TransactionSearchSchema>;
