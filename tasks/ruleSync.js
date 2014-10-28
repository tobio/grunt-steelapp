(function() {
    var _ = require('underscore');
    var path = require('path');
    var Q = require('q');
    var request = require('request');

    function urlForRule(server, rule) {
        return [
            'https://',
            server,
            ':9070/api/tm/1.0/config/active/rules/',
            rule
        ].join('');
    }

    function urlForApplication(server, application) {
        return [
            'https://',
            server,
            ':9070/api/tm/1.0/config/active/vservers/' + application
        ].join('');
    }

    function getAuth() {
        return {
            user: 'username',
            pass: 'password',
            sendImmediately: true
        };
    }

    function loadRulesMapping(grunt, config) {
        _.each(config.servers, function(server) {
            server.rules = {};

            _.each(server.vservers, function(vserver) {
                var filename = path.join(config.rulesConfigDirectory, vserver + '.json');
                server.rules[vserver] = grunt.file.readJSON(filename);
            });
        });
    }

    function verifyRulesExist(grunt, config) {
        var files = { };

        function addFile(rule) {
            files[rule] = true;
        }

        _.each(config.servers, function(server) {
            _.each(server.rules, function(application) {
                _.each(application.request_rules, addFile);
                _.each(application.response_rules, addFile);
            });
        });

        files = _.map(files, function(_, file) {
            return path.join(config.rulesDirectory, file + '.rule');
        });

        var missingFiles = _.filter(files, function(file) {
            return !grunt.file.isFile(file);
        });

        if(missingFiles.length) {
            grunt.fail.fatal('Detected missing rule files: ' + JSON.stringify(missingFiles));
        }
    }

    function settlePromiseFromRequest(deferred, error, response, body) {
        if(error || response.statusCode > 399) {
            deferred.reject(error || response);
        } else {
            deferred.resolve(body);
        }
    }

    function updateRules(grunt, config, server, serverName) {
        var rules = { };

        function addRule(rule) {
            var filename;

            if(!rules[rule]) {
                filename = path.join(config.rulesDirectory, rule + '.rule');
                rules[rule] = grunt.file.read(filename).trim();
            }
        }

        _.each(server.rules, function(application) {
            _.each(application.request_rules, addRule);
            _.each(application.response_rules, addRule);
        });

        var promises = _.map(rules, function(ruleText, ruleName) {
            var deferred = Q.defer();

            request({
                url: urlForRule(serverName, ruleName),
                method: 'PUT',
                auth: getAuth(),
                headers: {
                    'Accept': 'application/octet-stream'
                },
                body: ruleText,
                strictSSL: false
            }, function(error, response, body) {
                settlePromiseFromRequest(deferred, error, response, body);
            });

            return deferred.promise;
        });

        return Q.all(promises);
    }

    function updateApplication(grunt, config, server, application, rules) {
        var getDeferred = Q.defer(),
            url = urlForApplication(server, application),
            filename = path.join(config.vserversDirectory, application + '.json');

        if(grunt.file.isFile(filename)) {
            grunt.log.ok('Detected local configuration for ' + server + ':' + application);
            var appJson = grunt.file.readJSON(filename);

            getDeferred.resolve(appJson);
        } else {
            grunt.log.ok('Loading remote configuration for ' + server + ':' + application);
            request({
                url: url,
                method: 'GET',
                auth: getAuth(),
                headers: {
                    'Accept': 'application/json'
                },
                json: true,
                strictSSL: false
            }, function(error, response, body) {
                settlePromiseFromRequest(getDeferred, error, response, body);
            });
        }

        var update = getDeferred.promise.then(function(lbApplication) {
            var deferred = Q.defer();

            lbApplication.properties.basic.request_rules = rules.request_rules;
            lbApplication.properties.basic.response_rules = rules.response_rules;

            request({
                url: url,
                method: 'PUT',
                auth: getAuth(),
                headers: {
                    'Accept': 'application/json'
                },
                json: true,
                body: lbApplication,
                strictSSL: false
            }, function(error, response, body) {
                settlePromiseFromRequest(deferred, error, response);
            });
        deferred.resolve();

            return deferred.promise;
        });

        return update;
    }

    function updateServerApplications(grunt, config, server, serverName) {
        var promises = _.map(server.vservers, function(application) {
            return updateApplication(grunt, config, serverName, application, server.rules[application]);
        });

        return Q.all(promises);
    }

    module.exports = function(grunt) {
        grunt.registerTask('loadbalancerConfiguration', function() {
            var done = this.async();
            var config = grunt.config.get('lbConfig').options;
            config.rulesDirectory = path.resolve(config.rulesDirectory);
            config.rulesConfigDirectory = path.resolve(config.rulesConfigDirectory);
            config.vserversDirectory = path.resolve(config.vserversDirectory);

            loadRulesMapping(grunt, config);
            verifyRulesExist(grunt, config);
            grunt.log.ok('Loaded and verified rules configuration');

            var promises = _.map(config.servers, function(server, serverName) {
                grunt.log.ok('Updating rules for ' + serverName);
                var rulesUpdate = updateRules(grunt, config, server, serverName);
                var applicationUpdates = rulesUpdate.then(function() {
                    grunt.log.ok('Updated rules for ' + serverName);
                    return updateServerApplications(grunt, config, server, serverName);
                });

                applicationUpdates.then(function() {
                    grunt.log.ok('Updated application rule mappings for ' + serverName);
                });

                return applicationUpdates;
            });

            Q.all(promises, function(result) {
                grunt.log.ok('Loadbalancer configuration updated successfully');
                done();
            }, function(failures) {
                grunt.log.error('Failed to update loadbalancer rules');
                grunt.log.error(JSON.stringify(failures));
                done(false);
            }).done();
        });
    };
})();