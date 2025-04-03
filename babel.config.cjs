module.exports = {
    presets: [
        [
            '@babel/preset-env',
            {
                targets: {
                    node: 'current',
                },
                // modules: false,
            },
        ],
    ],
    plugins: [
        'babel-plugin-transform-import-meta',
        // '@babel/plugin-syntax-import-meta',
    ],
};
