const async = require('async');
const MusixmatchApi = require('./build/javascript-client/src/index');
const config = require('./.config');
const defaultClient = MusixmatchApi.ApiClient.instance;
const key = defaultClient.authentications['key'];
const _ = require('underscore');
key.apiKey = config.musixMatchAPIKey.lukes; // {String} 
var fs = require('fs');
var NaturalLanguageUnderstandingV1 = require('watson-developer-cloud/natural-language-understanding/v1.js');
var SyllaRhyme = require('syllarhyme');
var https = require('https');
const mongoose = require('mongoose');
const LyricsModel = require('./lyrics_schema');
const db = config.db.testDB;



var nlu = new NaturalLanguageUnderstandingV1({
    'username': config.josh2Credentials.username,
    'password': config.josh2Credentials.password,
    version_date: NaturalLanguageUnderstandingV1.VERSION_DATE_2017_02_27
});


const artists = new MusixmatchApi.ArtistApi();
const albums = new MusixmatchApi.AlbumApi();
const tracks = new MusixmatchApi.TrackApi();
const lyrics = new MusixmatchApi.LyricsApi();

const artist = 'bugzy malone';  // drake, dr dre, snoop, eminem, nicki minaj, a tribe called quest, ll cool j, kendrick lamar, biggie, 2pac, queen latifah, lil kim, de la soul, busta rhymes, ghostface killah, krs-one, big sean, chris brown, lil wayne, skepta, bugzy malone

async.waterfall([
    getArtistId,
    getAlbumsFromId,
    getTracksFromAlbums,
    getLyricsFromTracks,
    getKeywordsFromLyrics,
    getNumberOfSyllablesAndLastWord,
    getRhymes
],
    function (err, results) {
        if (err) console.log('Final Error: ', err);
        results = results.filter(function (el) {
            return el.rhymes.length > 0;
        });
        fs.appendFileSync('lyrics2.txt', ',' + JSON.stringify(results), 'UTF-8', {'flags': 'a+'});
        mongoose.connect(db, (err) => {
            if (err) {
                console.log(err);
            }
            console.log(`connected to ${db}`);
            results.forEach((lyric, i) => {
                let lyricNew = new LyricsModel(lyric);
                lyricNew.save(function (err, doc) {
                    if (err) {
                        return console.log(err);
                    }
                    console.log(`Lyric ${i} ${doc.raw} saved to db`);
                });
            });

        });
    });

function getArtistId (next) {
    const ArtistOpts = {
        format: 'json',
        qArtist: artist,
        pageSize: 1
    };
    artists.artistSearchGet(ArtistOpts, (error, data, response) => {
        if (error) {
            console.error(error);
        } else if (response.text) {
            data = JSON.parse(response.text);
            // console.log(data.message.body.artist_list)
            data.message.body.artist_list.forEach(function (el) {
                console.log(el.artist.artist_name, el.artist.artist_id);
            });
            next(null, data.message.body.artist_list[0].artist.artist_id);
            // next(null, );
        }
        else {
            throw new Error('bad response');
        }
    });
}

function getAlbumsFromId (id, next) {
    let albumOpts = {
        format: 'json',
        sReleaseDate: 'desc',
        gAlbumName: 1
    };
    albums.artistAlbumsGetGet(id, albumOpts, (error, data, response) => {
        if (error) {
            console.error(error);
        } else if (response.text) {
            let res = [];
            data = JSON.parse(response.text);
            data.message.body.album_list.forEach(function (el) {
                res.push(el.album.album_id);
            });
            next(null, res);
        }
        else {
            throw new Error('bad response');
        }
    });
}

function getTracksFromAlbums (albumIds, next) {
    async.mapSeries(albumIds, function (id, done) {
        var trackOpts = {
            format: 'json',
            pageSize: 20
        };
        tracks.albumTracksGetGet(id, trackOpts, (error, data, response) => {
            if (error) {
                console.error(error);
            } else if (response.text) {
                data = JSON.parse(response.text);
                let trackz = [];
                data.message.body.track_list.forEach(function (el) {
                    trackz.push(el.track.track_id);
                });
                done(null, trackz);
            }
            else {
                throw new Error('bad response');
            }
        });
    }, function (error, results) {
        if (error) console.log(error);
        next(null, _.flatten(results));
    });

}

function getLyricsFromTracks (tracks, next) {
    async.mapSeries(tracks, function (eachTrack, done) {
        var lyricsOpts = {
            format: 'json',
        };
        lyrics.trackLyricsGetGet(eachTrack, lyricsOpts, (error, data, response) => {
            if (error) {
                console.error(error);
            } else if (response.text) {
                data = JSON.parse(response.text);
                if (data.message.header.status_code === 200) {
                    var lyric = data.message.body.lyrics.lyrics_body.split('\n');
                }
                // console.log(lyric);
                done(null, lyric);
            }
            else {
                throw new Error('bad response')
                // done(null, [])
            }

        });


    }, function (error, results) {
        results = results.filter(function (el) {
            return el !== undefined;
        });
        results = results.map(function (el) {
            el = el.filter(function (line) {
                return line !== undefined;
            });
            el.pop();
            return _.uniq(el);
        });
        results = _.uniq(_.flatten(results));
        next(null, results);
    });
}


function getKeywordsFromLyrics (lines, next) {
    console.log('*****************************************************************', lines.length);
    Promise.all(
        lines.slice(101, 600).map(createNluPromise)
    ).then(responses => {
        var finalResult = [];
        lines.slice(101, 600).forEach((line, i) => {
            var keywords = [];
            if (responses[i]) {
                responses[i].keywords.forEach(function (el) {
                    keywords.push(el.text);
                });
                var result = {
                    raw: line,
                    keywords: keywords,
                    artist: artist
                };
                finalResult.push(result);
            }
        });
        next(null, finalResult);
    })
        .catch(error => {
            console.log(error);
        });
}

function createNluPromise (line) {
    return new Promise((resolve, reject) => {
        // console.log(line);
        nlu.analyze({
            'html': line,
            'features': {
                'keywords': {}
            }
        }, function (err, response) {
            if (err) {
                console.log(err);
                // console.log("Erro line?", line);
                // reject(err);
                resolve();
            }
            else {
                // console.log(response);
                resolve(response);
            }
        });
    });
}

function getNumberOfSyllablesAndLastWord (lyricsArray, next) {
    Promise.all(
        lyricsArray.map(findSyllables)
    ).then(response => {
        lyricsArray.map(function (el, i) {
            el.syllables = response[i];
            el.lastWord = el.raw.split(' ').slice(-1)[0].replace(/[^A-z]/g, '');
            if (el.keywords.length === 0) el.keywords.push(el.lastWord);
        });
        next(null, lyricsArray);
    })
        .catch(error => console.log(error));
}

function findSyllables (line) {
    return new Promise(function (resolve) {
        let syllables = 0;
        SyllaRhyme(function (sr) {
            syllables = sr.syllables(line.raw);
            resolve(syllables);
        });
    });
}

function getRhymes (lyricsArray, next) {
    Promise.all(
        lyricsArray.map(rhymeGetRequest)
    ).then(response => {
        let rhymes = response.map(function (el) {
            return el.reduce(function (acc, el2) {
                acc.push(el2.word);
                return acc;
            }, []);
        });
        lyricsArray.map(function (el, i) {
            el.rhymes = rhymes[i];
        });
        next(null, lyricsArray);
    });
}

function rhymeGetRequest (el) {
    return new Promise(function (resolve) {
        let rhymes = '';
        let lookUpWord = el.lastWord;
        https.get(`https://api.datamuse.com/words?rel_rhy=${lookUpWord}`, function (res) {
            res.on('data', function (chunk) {
                rhymes += chunk;
                // console.log(rhymes);
                rhymes = JSON.parse(rhymes);
                resolve(rhymes);
            });
            res.on('end', function (rhymes) {
            });
        });
    });
}