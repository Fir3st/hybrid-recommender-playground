/*
* Based on https://github.com/stanleyfok/content-based-recommender
*/

import * as _ from 'lodash';
import * as Vector from 'vector-object';
import * as striptags from 'striptags';
import * as sw from 'stopword';
import * as natural from 'natural';
import { LDA } from '../util/lda';

const { TfIdf, PorterStemmer, NGrams } = natural;
const tokenizer = new natural.WordTokenizer();

interface IOptions {
    maxVectorSize?: number;
    maxSimilarDocuments?: number;
    minScore?: number;
    debug?: boolean;
}

const defaultOptions: IOptions = {
    maxVectorSize: 100,
    maxSimilarDocuments: Number.MAX_SAFE_INTEGER,
    minScore: 0,
    debug: true
};

export default class CBRecommender {
    private options: IOptions = null;
    private data = {};

    constructor(options: IOptions = null) {
        this.setOptions(options);
        this.data = {};
    }

    public setOptions(options: IOptions = null) {
        // validation
        if ((options.maxVectorSize !== undefined) &&
            (!Number.isInteger(options.maxVectorSize) || options.maxVectorSize <= 0)) {
            throw new Error('The option maxVectorSize should be integer and greater than 0');
        }

        if ((options.maxSimilarDocuments !== undefined) &&
            (!Number.isInteger(options.maxSimilarDocuments) || options.maxSimilarDocuments <= 0)) {
            throw new Error('The option maxSimilarDocuments should be integer and greater than 0');
        }

        if ((options.minScore !== undefined) &&
            (!_.isNumber(options.minScore) || options.minScore < 0 || options.minScore > 1)) {
            throw new Error('The option minScore should be a number between 0 and 1');
        }

        this.options = {
            ...defaultOptions,
            ...options
        };
    }

    public train(documents) {
        this.validateDocuments(documents);

        if (this.options.debug) {
            console.log(`Total documents: ${documents.length}`);
        }

        // step 1 - preprocess the documents
        const preprocessDocs = this.preprocessDocuments(documents, this.options);
        console.log(preprocessDocs);

        /*  // step 2 - create document vectors
        const docVectors = this.produceWordVectors(preprocessDocs, this.options);

        // step 3 - calculate similarities
        this.data = this.calculateSimilarities(docVectors, this.options); */
    }

    public validateDocuments(documents) {
        if (!_.isArray(documents)) {
            throw new Error('Documents should be an array of objects');
        }

        for (let i = 0; i < documents.length; i += 1) {
            const document = documents[i];

            if (!_.has(document, 'id') || !_.has(document, 'content')) {
                throw new Error('Documents should be have fields id and content');
            }
        }
    }

    public getSimilarDocuments(id, start = 0, size = undefined) {
        let similarDocuments = this.data[id];

        if (similarDocuments === undefined) {
            return [];
        }

        const end = (size !== undefined) ? start + size : undefined;
        similarDocuments = similarDocuments.slice(start, end);

        return similarDocuments;
    }

    private preprocessDocuments(documents, options) {
        if (options.debug) {
            console.log('Preprocessing documents');
        }
        const lda = new LDA();
        const ldaResult = lda.process(documents, 3);
        const processedDocuments = documents.map((item) => {
            const documentTopics = ldaResult.docs.filter(doc => doc.documentId === item.id)[0].topics;
            return { id: item.id, topics: documentTopics };
        });

        return processedDocuments;
    }

    private produceWordVectors(processedDocuments, options) {
        // process tfidf
        const tfidf = new TfIdf();

        processedDocuments.forEach((processedDocument) => {
            tfidf.addDocument(processedDocument.tokens);
        });

        // create word vector
        const documentVectors = [];

        for (let i = 0; i < processedDocuments.length; i += 1) {
            if (options.debug) {
                console.log(`Creating word vector for document ${i}`);
            }

            const processedDocument = processedDocuments[i];
            const hash = {};

            const items = tfidf.listTerms(i);
            const maxSize = Math.min(options.maxVectorSize, items.length);
            for (let j = 0; j < maxSize; j += 1) {
                const item = items[j];
                hash[item.term] = item.tfidf;
            }

            const documentVector = {
                id: processedDocument.id,
                vector: new Vector(hash)
            };

            documentVectors.push(documentVector);
        }

        return documentVectors;
    }

    private calculateSimilarities(documentVectors, options) {
        const data = {};

        // initialize data hash
        for (let i = 0; i < documentVectors.length; i += 1) {
            const documentVector = documentVectors[i];
            const { id } = documentVector;

            data[id] = [];
        }

        // calculate the similar scores
        for (let i = 0; i < documentVectors.length; i += 1) {
            if (options.debug) {
                console.log(`Calculating similarity score for document ${i}`);
            }

            for (let j = 0; j < i; j += 1) {
                const idi = documentVectors[i].id;
                const vi = documentVectors[i].vector;
                const idj = documentVectors[j].id;
                const vj = documentVectors[j].vector;
                const similarity = vi.getCosineSimilarity(vj);

                if (similarity > options.minScore) {
                    data[idi].push({ id: idj, score: similarity });
                    data[idj].push({ id: idi, score: similarity });
                }
            }
        }

        // finally sort the similar documents by descending order
        Object.keys(data).forEach((id) => {
            data[id].sort((a, b) => b.score - a.score);

            if (data[id].length > options.maxSimilarDocuments) {
                data[id] = data[id].slice(0, options.maxSimilarDocuments);
            }
        });

        return data;
    }
}
