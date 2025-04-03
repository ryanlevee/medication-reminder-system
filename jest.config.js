export default {
    testEnvironment: 'node',
    testPathIgnorePatterns: ['/node_modules/', '/backup/', '/archive/'],
    moduleNameMapper: {
        '^(\\.{1,2}/.*)\\.js$': '$1',
    },
    transform: {
        '^.+\\.js$': 'babel-jest',
    },
};
