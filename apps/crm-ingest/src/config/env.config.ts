import path from 'node:path';
import { getEnvFileNameForNodeEnv } from '@novu/shared';
import dotenv from 'dotenv';

dotenv.config({ path: path.join(__dirname, '..', getEnvFileNameForNodeEnv(process.env.NODE_ENV)) });
