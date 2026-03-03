#!/usr/bin/env node

import { Command } from "commander";
import { registerSearchCommands } from "./commands/search.js";
import { registerMenuCommands } from "./commands/menu.js";
import { registerCartCommands } from "./commands/cart.js";
import { registerOrderCommands } from "./commands/order.js";
import { registerAuthCommands } from "./commands/auth.js";
import { registerLocationCommands } from "./commands/location.js";

const program = new Command();

program
  .name("foodpanda-cli")
  .description("CLI for ordering food from foodpanda.ph — designed for AI assistants")
  .version("0.1.0");

registerSearchCommands(program);
registerMenuCommands(program);
registerCartCommands(program);
registerOrderCommands(program);
registerAuthCommands(program);
registerLocationCommands(program);

program.parse();
