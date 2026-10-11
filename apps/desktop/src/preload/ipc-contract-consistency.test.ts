import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { IpcChannel } from '@betterwork/agent-protocol';
import ts from 'typescript';
import { expect, it } from 'vitest';

interface MainInvokeContract {
  helper: string;
  request: ts.Expression;
  response: ts.Expression;
}

interface PreloadInvokeContract {
  request: ts.Expression;
  response: ts.Expression;
}

interface MainEventSend {
  channel: string;
  payload: ts.Expression;
}

interface ScheduleResponseInput {
  successData: ts.Type;
  rejectedError: ts.Type;
}

function channelMember(node: ts.Node | undefined): string | undefined {
  if (
    !node ||
    !ts.isPropertyAccessExpression(node) ||
    !ts.isIdentifier(node.expression) ||
    node.expression.text !== 'IpcChannel'
  ) {
    return undefined;
  }
  return node.name.text;
}

function requiredArgument(call: ts.CallExpression, index: number, label: string): ts.Expression {
  const argument = call.arguments[index];
  if (!argument) throw new Error(`${label} is missing argument ${index + 1}`);
  return argument;
}

function sourceFile(program: ts.Program, sourcePath: string): ts.SourceFile {
  const source = program.getSourceFile(sourcePath);
  if (!source) throw new Error(`TypeScript program did not load ${sourcePath}`);
  return source;
}

function findSchemaPropertyType(
  checker: ts.TypeChecker,
  schemaExpression: ts.Expression,
  propertyName: '_input' | '_output',
): ts.Type {
  const schemaType = checker.getTypeAtLocation(schemaExpression);
  const property = checker.getPropertyOfType(schemaType, propertyName);
  if (!property) {
    throw new Error(`Schema ${schemaExpression.getText()} has no ${propertyName} type`);
  }
  return checker.getTypeOfSymbolAtLocation(property, schemaExpression);
}

function propertyInitializer(
  object: ts.ObjectLiteralExpression,
  propertyName: string,
): ts.Expression | undefined {
  for (const property of object.properties) {
    if (
      ts.isPropertyAssignment(property) &&
      ts.isIdentifier(property.name) &&
      property.name.text === propertyName
    ) {
      return property.initializer;
    }
  }
  return undefined;
}

function extractInvokeContracts(source: ts.SourceFile): Map<string, PreloadInvokeContract> {
  const contracts = new Map<string, PreloadInvokeContract>();
  const visit = (node: ts.Node): void => {
    if (
      ts.isVariableDeclaration(node) &&
      node.initializer &&
      ts.isCallExpression(node.initializer) &&
      ts.isIdentifier(node.initializer.expression) &&
      node.initializer.expression.text === 'defineInvokeContracts'
    ) {
      const object = node.initializer.arguments[0];
      if (object && ts.isObjectLiteralExpression(object)) {
        for (const property of object.properties) {
          if (
            !ts.isPropertyAssignment(property) ||
            !ts.isComputedPropertyName(property.name) ||
            !ts.isObjectLiteralExpression(property.initializer)
          ) {
            continue;
          }
          const channel = channelMember(property.name.expression);
          if (!channel) continue;
          const request = propertyInitializer(property.initializer, 'request');
          const response = propertyInitializer(property.initializer, 'response');
          if (!request || !response) {
            throw new Error(`Preload contract ${channel} is missing a schema`);
          }
          contracts.set(channel, { request, response });
        }
      }
    }
    ts.forEachChild(node, visit);
  };
  visit(source);
  return contracts;
}

function extractEventContracts(source: ts.SourceFile): Map<string, ts.Expression> {
  const contracts = new Map<string, ts.Expression>();
  const visit = (node: ts.Node): void => {
    if (
      ts.isVariableDeclaration(node) &&
      node.initializer &&
      ts.isCallExpression(node.initializer) &&
      ts.isIdentifier(node.initializer.expression) &&
      node.initializer.expression.text === 'defineEventContracts'
    ) {
      const object = node.initializer.arguments[0];
      if (object && ts.isObjectLiteralExpression(object)) {
        for (const property of object.properties) {
          if (
            !ts.isPropertyAssignment(property) ||
            !ts.isComputedPropertyName(property.name) ||
            !ts.isObjectLiteralExpression(property.initializer)
          ) {
            continue;
          }
          const channel = channelMember(property.name.expression);
          if (!channel) continue;
          const event = propertyInitializer(property.initializer, 'event');
          if (!event) throw new Error(`Preload event ${channel} has no schema`);
          contracts.set(channel, event);
        }
      }
    }
    ts.forEachChild(node, visit);
  };
  visit(source);
  return contracts;
}

function extractMainInvokeContracts(source: ts.SourceFile): Map<string, MainInvokeContract[]> {
  const contracts = new Map<string, MainInvokeContract[]>();
  const helpers = new Set([
    'handleInput',
    'handleOptionalInput',
    'handleNoInput',
    'handleScheduleInput',
  ]);
  const visit = (node: ts.Node): void => {
    if (
      ts.isCallExpression(node) &&
      ts.isIdentifier(node.expression) &&
      helpers.has(node.expression.text)
    ) {
      const channel = channelMember(node.arguments[0]);
      if (channel) {
        const contract: MainInvokeContract = {
          helper: node.expression.text,
          request: requiredArgument(node, 1, channel),
          response: requiredArgument(node, 2, channel),
        };
        const existing = contracts.get(channel) ?? [];
        existing.push(contract);
        contracts.set(channel, existing);
      }
    }
    ts.forEachChild(node, visit);
  };
  visit(source);
  return contracts;
}

function extractMainEventSends(program: ts.Program, mainRoot: string): MainEventSend[] {
  const sends: MainEventSend[] = [];
  for (const source of program.getSourceFiles()) {
    if (
      !source.fileName.startsWith(`${mainRoot}${path.sep}`) ||
      source.fileName.endsWith('.test.ts') ||
      source.fileName.endsWith('.bench.test.ts')
    ) {
      continue;
    }
    const visit = (node: ts.Node): void => {
      if (
        ts.isCallExpression(node) &&
        ts.isPropertyAccessExpression(node.expression) &&
        node.expression.name.text === 'send'
      ) {
        const channel = channelMember(node.arguments[0]);
        const payload = node.arguments[1];
        if (channel && payload) sends.push({ channel, payload });
      }
      ts.forEachChild(node, visit);
    };
    visit(source);
  }
  return sends;
}

function removeUndefinedVariants(type: ts.Type): ts.Type[] {
  const variants = type.isUnion() ? type.types : [type];
  return variants.filter((variant) => (variant.flags & ts.TypeFlags.Undefined) === 0);
}

function stringLiteralValues(checker: ts.TypeChecker, type: ts.Type): string[] {
  const variants = type.isUnion() ? type.types : [type];
  return variants.flatMap((variant) => {
    if ((variant.flags & ts.TypeFlags.StringLiteral) === 0) return [];
    const value = checker.typeToString(variant);
    return [value.slice(1, -1)];
  });
}

function scheduleResponseInput(
  checker: ts.TypeChecker,
  responseSchema: ts.Expression,
  channel: string,
): ScheduleResponseInput {
  const responseInput = findSchemaPropertyType(checker, responseSchema, '_input');
  const variants = responseInput.isUnion() ? responseInput.types : [responseInput];
  let successData: ts.Type | undefined;
  let rejectedError: ts.Type | undefined;
  for (const variant of variants) {
    const status = checker.getPropertyOfType(variant, 'status');
    if (!status) continue;
    const statusType = checker.getTypeOfSymbolAtLocation(status, responseSchema);
    const statusValues = stringLiteralValues(checker, statusType);
    if (statusValues.includes('success')) {
      const data = checker.getPropertyOfType(variant, 'data');
      if (data) successData = checker.getTypeOfSymbolAtLocation(data, responseSchema);
    }
    if (statusValues.includes('rejected')) {
      const error = checker.getPropertyOfType(variant, 'error');
      if (error) rejectedError = checker.getTypeOfSymbolAtLocation(error, responseSchema);
    }
  }
  if (!successData || !rejectedError) {
    throw new Error(
      `Schedule Preload contract ${channel} must accept success and rejected results`,
    );
  }
  return { successData, rejectedError };
}

function findScheduleErrorOutput(checker: ts.TypeChecker, source: ts.SourceFile): ts.Type {
  let errorType: ts.Type | undefined;
  const visit = (node: ts.Node): void => {
    if (
      ts.isVariableDeclaration(node) &&
      ts.isIdentifier(node.name) &&
      node.name.text === 'scheduleErrorFrom'
    ) {
      const functionType = checker.getTypeAtLocation(node.name);
      const signature = checker.getSignaturesOfType(functionType, ts.SignatureKind.Call)[0];
      if (signature) errorType = checker.getReturnTypeOfSignature(signature);
    }
    ts.forEachChild(node, visit);
  };
  visit(source);
  if (!errorType) throw new Error('Main schedule error mapper has no inferred return type');
  return errorType;
}

it('links every Main IPC schema to its Preload channel contract', () => {
  const preloadPath = fileURLToPath(new URL('./index.ts', import.meta.url));
  const configPath = ts.findConfigFile(
    path.dirname(preloadPath),
    (fileName) => ts.sys.fileExists(fileName),
    'tsconfig.json',
  );
  if (!configPath) throw new Error('Repository tsconfig is missing');
  const config = ts.readConfigFile(configPath, (fileName) => ts.sys.readFile(fileName));
  expect(config.error).toBeUndefined();
  const parsed = ts.parseJsonConfigFileContent(config.config, ts.sys, path.dirname(configPath));
  expect(parsed.errors).toEqual([]);

  const mainRoot = path.resolve(path.dirname(preloadPath), '../main');
  const mainSources = ts.sys
    .readDirectory(mainRoot, ['.ts', '.tsx'], undefined, ['**/*'])
    .filter((sourcePath) => !sourcePath.endsWith('.test.ts'));
  const program = ts.createProgram({
    rootNames: [...new Set([...mainSources, preloadPath])],
    options: { ...parsed.options, noEmit: true },
  });
  const checker = program.getTypeChecker();
  const mainIpc = sourceFile(program, path.join(mainRoot, 'ipc/register-ipc.ts'));
  const preload = sourceFile(program, preloadPath);
  const mainInvokes = extractMainInvokeContracts(mainIpc);
  const preloadInvokes = extractInvokeContracts(preload);
  const preloadEvents = extractEventContracts(preload);
  const mainScheduleErrorOutput = findScheduleErrorOutput(checker, mainIpc);
  const failures: string[] = [];
  const describeType = (type: ts.Type): string =>
    checker.typeToString(type, undefined, ts.TypeFormatFlags.NoTruncation);

  const invokeChannelNames = Object.keys(IpcChannel).filter(
    (channel) => !preloadEvents.has(channel),
  );
  expect([...mainInvokes.keys()].sort()).toEqual(invokeChannelNames.sort());
  expect([...preloadInvokes.keys()].sort()).toEqual(invokeChannelNames.sort());

  for (const channel of invokeChannelNames) {
    const mainContracts = mainInvokes.get(channel) ?? [];
    const preloadContract = preloadInvokes.get(channel);
    if (mainContracts.length !== 1 || !preloadContract) {
      failures.push(`${channel}: expected one Main registration and one Preload contract`);
      continue;
    }
    const mainContract = mainContracts[0];
    if (!mainContract) {
      failures.push(`${channel}: Main registration was not available`);
      continue;
    }

    const mainRequestInput = findSchemaPropertyType(checker, mainContract.request, '_input');
    const preloadRequestOutput = findSchemaPropertyType(
      checker,
      preloadContract.request,
      '_output',
    );
    const providedRequestVariants =
      mainContract.helper === 'handleOptionalInput'
        ? removeUndefinedVariants(preloadRequestOutput)
        : [preloadRequestOutput];
    if (
      providedRequestVariants.length === 0 ||
      providedRequestVariants.some(
        (provided) => !checker.isTypeAssignableTo(provided, mainRequestInput),
      )
    ) {
      failures.push(
        `${channel}: Preload request output ${describeType(preloadRequestOutput)} is not accepted by Main input ${describeType(mainRequestInput)}`,
      );
    }

    const mainResponseOutput = findSchemaPropertyType(checker, mainContract.response, '_output');
    if (mainContract.helper === 'handleScheduleInput') {
      const scheduleInput = scheduleResponseInput(checker, preloadContract.response, channel);
      if (!checker.isTypeAssignableTo(mainResponseOutput, scheduleInput.successData)) {
        failures.push(
          `${channel}: Main response ${describeType(mainResponseOutput)} is not accepted by Schedule success data ${describeType(scheduleInput.successData)}`,
        );
      }
      if (!checker.isTypeAssignableTo(mainScheduleErrorOutput, scheduleInput.rejectedError)) {
        failures.push(
          `${channel}: Main schedule error ${describeType(mainScheduleErrorOutput)} is not accepted by Preload rejected error ${describeType(scheduleInput.rejectedError)}`,
        );
      }
    } else {
      const preloadResponseInput = findSchemaPropertyType(
        checker,
        preloadContract.response,
        '_input',
      );
      if (!checker.isTypeAssignableTo(mainResponseOutput, preloadResponseInput)) {
        failures.push(
          `${channel}: Main response ${describeType(mainResponseOutput)} is not accepted by Preload response ${describeType(preloadResponseInput)}`,
        );
      }
    }
  }

  const mainEventSends = extractMainEventSends(program, mainRoot);
  const sentEventNames = [...new Set(mainEventSends.map((send) => send.channel))].sort();
  expect(sentEventNames).toEqual([...preloadEvents.keys()].sort());

  for (const send of mainEventSends) {
    const eventSchema = preloadEvents.get(send.channel);
    if (!eventSchema) {
      failures.push(`${send.channel}: Main sends an event without a Preload contract`);
      continue;
    }
    const mainPayload = checker.getTypeAtLocation(send.payload);
    const preloadEventInput = findSchemaPropertyType(checker, eventSchema, '_input');
    if (!checker.isTypeAssignableTo(mainPayload, preloadEventInput)) {
      failures.push(
        `${send.channel}: Main event ${describeType(mainPayload)} is not accepted by Preload event ${describeType(preloadEventInput)}`,
      );
    }
  }

  expect(failures).toEqual([]);
}, 20_000);
