import dotenv from "dotenv";
import { fillEmptyGeminiTextEnvironment } from "./environment";

const configPath = process.env.DOTENV_CONFIG_PATH?.trim();
const result = dotenv.config(configPath ? { path: configPath } : undefined);
if (result.parsed) fillEmptyGeminiTextEnvironment(process.env, result.parsed);
