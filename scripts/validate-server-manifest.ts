import { readFile } from 'fs/promises';

interface PackageMeta {
  name: string;
  version: string;
  description: string;
  repository: {
    url: string;
  };
  homepage: string;
  author: {
    name: string;
    url: string;
  };
}

interface ServerMeta {
  name: string;
  version: string;
  description: string;
  homepage: string;
  repository: {
    url: string;
  };
  author: {
    name: string;
    url: string;
  };
  packages: Array<{
    identifier: string;
    version: string;
  }>;
}

async function main() {
  const packageJson = JSON.parse(await readFile('package.json', 'utf-8')) as PackageMeta;
  const serverJson = JSON.parse(await readFile('server.json', 'utf-8')) as ServerMeta;

  if (serverJson.packages[0]?.identifier !== packageJson.name) {
    throw new Error('server.json package identifier does not match package.json name');
  }
  if (serverJson.version !== packageJson.version) {
    throw new Error('server.json version does not match package.json version');
  }
  if (serverJson.description !== packageJson.description) {
    throw new Error('server.json description does not match package.json description');
  }
  if (serverJson.homepage !== packageJson.homepage) {
    throw new Error('server.json homepage does not match package.json homepage');
  }
  if (serverJson.repository.url !== packageJson.repository.url) {
    throw new Error('server.json repository URL does not match package.json repository URL');
  }
  if (serverJson.author.name !== packageJson.author.name) {
    throw new Error('server.json author does not match package.json author');
  }

  console.log('Manifest validation passed.');
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
