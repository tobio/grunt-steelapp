(function() {
    var fs = require('fs');
    var path = require('path');
    var request = require('request');
    var Q = require('q');
    var _ = require('underscore');

    function urlForApplications(server) {
        return appendHost(server, '/api/tm/1.0/config/active/vservers/');
    }

    function appendHost(server, path) {
        return [
            'https://',
            server,
            ':9070',
            path
        ].join('');
    }

    function dumpConfig(serverName, baseDirectory) {
        var deferred = Q.defer(),
            url = urlForApplications(serverName),
            auth = {
                user: 'username',
                pass: 'password'
            };

        request({
            url: url,
            method: 'GET',
            auth: auth,
            headers: {
                'Accept': 'application/json'
            },
            json: true
        }, function(error, response, body) {
            console.log('Get all error: ' + error);
            console.log('Get all response code: ' + response.statusCode);
            if(error || response.statusCode > 399) {
                deferred.reject(error || response);
            } else {
                deferred.resolve(body);
            }
        });

        return deferred.promise.then(function(applications) {
            console.log('Syncing applications: ' +
                _.map(applications.children, function(app) { return app.name; }).join(', '));
            var promises = _.map(applications.children, function(app) {
                var def = Q.defer();

                request({
                    url: appendHost(serverName, app.href),
                    method: 'GET',
                    auth: auth,
                    headers: {
                        'Accept': 'application/json'
                    },
                    json: true
                }, function(error, response, body) {
                    if(error || response.statusCode > 399) {
                        def.reject(error || response);
                    } else {
                        var rules = {
                            request_rules: body.properties.basic.request_rules,
                            response_rules: body.properties.basic.response_rules
                        };

                        delete body.properties.basic.request_rules;
                        delete body.properties.basic.response_rules;

                        fs.writeFileSync(
                            path.join(baseDirectory, 'vservers', app.name + '.json'),
                            JSON.stringify(body, null, '\t'));

                        fs.writeFileSync(
                            path.join(baseDirectory, 'rules', app.name + '.json'),
                            JSON.stringify(rules, null, '\t'));

                        def.resolve(body);
                    }
                });

                return def.promise;
            });

            return Q.all(promises);
        });
    }

    module.exports = {
        dump: dumpConfig
    };
})();