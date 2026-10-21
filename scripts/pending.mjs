const task = process.argv[2];
console.error(task === 'seed'
  ? 'Synthetic seeds are not implemented. No database was changed.'
  : 'VS01-VS16 acceptance is not implemented. Scaffold tests are not feature acceptance.');
process.exitCode = 1;
