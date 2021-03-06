/* eslint camelcase:0 */
'use strict'

// Imports
const extractOpts = require('extract-opts')
const naturalCompare = require('string-natural-compare')
const githubAuthQueryString = require('githubauthquerystring').fetch()

const keyorder =
	'id name github gitlab bitbucket website license language description created_at updated_at abandoned is extensible stars forks watchers'

function sort(data) {
	return data.sort(
		(a, b) =>
			naturalCompare.caseInsensitive(a.name, b.name) ||
			naturalCompare.caseInsensitive(a.github, b.github)
	)
}

// Trim redundant data from the listing
function hydrate(data, opts, next) {
	if (!githubAuthQueryString)
		throw new Error(
			'environment variables GITHUB_CLIENT_ID and GITHUB_CLIENT_SECRET or GITHUB_ACCESS_TOKEN must be set'
		)
	;[opts, next] = extractOpts(opts, next)
	if (opts.corrective == null) opts.corrective = false
	if (opts.cache == null) opts.cache = 1000 * 60 * 60 * 24 // one day

	const extendr = require('extendr')
	const arrangekeys = require('arrangekeys')

	const rawMap = {}
	const hydratedMap = {}
	const githubRepos = []
	data.forEach(function(entry, index) {
		delete entry.id
		const key = (entry.github && entry.github.toLowerCase()) || index
		rawMap[key] = extendr.clone(arrangekeys(entry, keyorder))
		hydratedMap[key] = extendr.extend(
			{
				id: require('crypto')
					.createHash('md5')
					.update(
						JSON.stringify({
							name: entry.name,
							website: entry.website,
							github: entry.github
						})
					)
					.digest('hex')
			},
			arrangekeys(entry, keyorder)
		)
		if (entry.github) {
			githubRepos.push(entry.github)
		}
	})

	// Enhance with github data
	if (opts.log) {
		opts.log(
			'info',
			`Fetching the github information, all ${githubRepos.length} of them`
		)
	}
	require('getrepos')
		.create(opts)
		.fetchRepos(githubRepos, function(err, repos) {
			if (err) return next(err)

			// Prepare the projects with the github data
			repos.forEach(function(github) {
				const key = github.full_name.toLowerCase()

				// Confirm existance as name may have changed from the listing, for example a repo rename
				if (rawMap[key] == null) {
					if (opts.log) {
						opts.log(
							'warn',
							`${github.full_name} is missing, likely due to rename`
						)
					}
					return // skip
				}

				// Prepare
				const raw = rawMap[key]
				const hydrated = hydratedMap[key]

				// Apply github fields
				const fields = {
					description: github.description,
					language: github.language,
					license: github.license && github.license.key,
					website:
						github.homepage &&
						github.homepage.toLowerCase().indexOf(`github.com/${key}`) === -1 &&
						github.homepage,
					stars: github.stargazers_count,
					watchers: github.watchers_count,
					forks: github.forks_count,
					created_at: github.created_at,
					updated_at: github.updated_at
				}
				Object.keys(fields).forEach(function(key) {
					const value = fields[key]
					if (value) {
						if (
							opts.corrective &&
							raw[key] &&
							value &&
							raw[key].toLowerCase() === value.toLowerCase()
						) {
							if (opts.log) {
								opts.log(
									'note',
									`trimming ${key} on ${
										github.full_name
									} as it is the same as the github data: ${value}`
								)
							}
							delete raw[key]
						}
						if (hydrated[key] == null) {
							if (opts.log) {
								opts.log(
									'info',
									`added ${key} on ${github.full_name} from the github data`
								)
							}
							hydrated[key] = value
						}
					}
				})

				hydratedMap[key] = arrangekeys(hydrated, keyorder)
			})

			return next(null, {
				hydrated: sort(Object.keys(hydratedMap).map(k => hydratedMap[k])),
				raw: sort(Object.keys(rawMap).map(k => rawMap[k]))
			})
		})
}

module.exports = { keyorder, sort, hydrate }
