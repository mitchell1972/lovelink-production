const fs = require('fs');
const path = require('path');

const projectRoot = path.resolve(__dirname, '..');
const generatedConfigPath = path.join(
  projectRoot,
  'node_modules/react-native-iap/nitrogen/generated/ios/swift/InitConnectionConfig.swift'
);
const hybridIapPath = path.join(
  projectRoot,
  'node_modules/react-native-iap/ios/HybridRnIap.swift'
);

const PATCH_MARKER = 'LoveLink Xcode 16.2 Swift/C++ interoperability workaround';

const patchGeneratedConfig = () => {
  if (!fs.existsSync(generatedConfigPath)) {
    throw new Error(`react-native-iap generated config was not found: ${generatedConfigPath}`);
  }

  const source = fs.readFileSync(generatedConfigPath, 'utf8');
  if (source.includes(PATCH_MARKER)) return;

  const extensionMarker = '\npublic extension InitConnectionConfig {';
  const extensionIndex = source.indexOf(extensionMarker);
  if (extensionIndex < 0) {
    throw new Error('Unexpected react-native-iap InitConnectionConfig.swift shape');
  }

  // These fields configure Android alternative billing and are explicitly
  // ignored by the iOS implementation. Merely generating Swift accessors for
  // the C++ enum optionals crashes Swift 6.0.3 IRGen in Xcode 16.2. Keep the
  // typealias used by the Nitro bridge, but omit iOS-only dead accessors.
  const patched = `${source.slice(0, extensionIndex)}\n\n` +
    `// ${PATCH_MARKER}.\n` +
    '// Android-only InitConnectionConfig accessors are intentionally omitted.\n';
  fs.writeFileSync(generatedConfigPath, patched);
};

const patchIosImplementation = () => {
  if (!fs.existsSync(hybridIapPath)) {
    throw new Error(`react-native-iap iOS implementation was not found: ${hybridIapPath}`);
  }

  const source = fs.readFileSync(hybridIapPath, 'utf8');
  if (source.includes(`${PATCH_MARKER}: config log`)) return;

  const original = 'RnIapLog.payload("initConnection", config?.alternativeBillingModeAndroid)';
  if (!source.includes(original)) {
    throw new Error('Unexpected react-native-iap HybridRnIap.swift shape');
  }

  const replacement =
    `RnIapLog.payload("initConnection", config == nil ? nil : "provided") // ${PATCH_MARKER}: config log`;
  fs.writeFileSync(hybridIapPath, source.replace(original, replacement));
};

patchGeneratedConfig();
patchIosImplementation();
