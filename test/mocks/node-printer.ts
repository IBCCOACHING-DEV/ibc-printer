const mockNodePrinter = {
  getPrinters: jest
    .fn()
    .mockReturnValue([
      { name: 'test-printer', isDefault: true, status: 'ready' },
    ]),
  getDefaultPrinterName: jest.fn().mockReturnValue('test-printer'),
  print: jest.fn().mockImplementation((job) => {
    if (job.success) job.success('job-123');
  }),
};

export default mockNodePrinter;
