import * as compat from '../../src/utils/playwrightCompat.js';
import { RuntimeInspector } from '../../src/modules/debugger/RuntimeInspector.js';

describe('RuntimeInspector', () => {
  afterEach(() => {
    jest.restoreAllMocks();
  });

  test('reuses the debugger CDP session when one is already active', async () => {
    const sharedSession = {
      send: jest.fn().mockResolvedValue({}),
    };
    const collector = {
      getActivePage: jest.fn(),
    };
    const debuggerManager = {
      getCDPSession: jest.fn().mockReturnValue(sharedSession),
    };

    const compatSpy = jest.spyOn(compat, 'createCDPSessionForPage').mockResolvedValue({} as never);

    const inspector = new RuntimeInspector(collector as never, debuggerManager as never);

    await inspector.init();

    expect(compatSpy).not.toHaveBeenCalled();
    expect(sharedSession.send).toHaveBeenCalledWith('Runtime.enable');
  });
});
