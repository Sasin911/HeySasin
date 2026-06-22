import { z } from "zod";

export const threadContextSchema = z
  .number()
  .describe(
    "The thread identity to execute the code in (default: 8, normal game scripts run on 2)"
  )
  .optional()
  .default(8);
