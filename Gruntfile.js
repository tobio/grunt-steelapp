module.exports = function(grunt) {
    grunt.initConfig({
        lbConfig: {
            options: {
                servers: grunt.file.readJSON('./config.json'),
                rulesDirectory: './rules/rules/',
                rulesConfigDirectory: './rules/',
                vserversDirectory: './vservers/'
            }
        }
    });

    grunt.loadTasks('./tasks');
    grunt.registerTask('default', ['loadbalancerConfiguration']);
};