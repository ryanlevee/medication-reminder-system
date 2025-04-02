// jest.config.js
export default {
    testEnvironment: 'node',
    testPathIgnorePatterns: ['/node_modules/', '/backup/', '/archive/'],
    moduleNameMapper: {
        '^(\\.{1,2}/.*)\\.js$': '$1',
    },
    transform: {
        // Keep babel-jest for syntax, ensure modules:false in babel.config.js
        '^.+\\.js$': 'babel-jest',
    },
};
