module.exports = {
    presets: [
        [
            '@babel/preset-env',
            {
                targets: {
                    node: 'current', // Or a specific Node.js version if needed
                },
                // modules: false,
            },
            // '@babel/preset-typescript',
        ],
    ],
    plugins: [
        'babel-plugin-transform-import-meta',
        // '@babel/plugin-syntax-import-meta',
    ],
};
