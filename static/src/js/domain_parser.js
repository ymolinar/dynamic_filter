odoo.define('dynamic_filter.Utils', function (require) {
    let utils = require('web.utils');

    /**
     * Extend web.utils class to add a slug feature.
     */
    return _.extend(utils, {
        slug: function (text, replacement) {
            if (undefined === replacement) {
                replacement = '-';
            }
            const from = 'àáäâèéëêìíïîòóöôùúüûñçßÿœæŕśńṕẃǵǹḿǘẍźḧ&',
                to = 'aaaaeeeeiiiioooouuuuncsyoarsnpwgnmuxzh-',
                reg_exp = new RegExp(from.split('').join('|'), 'g');
            return text.toString().toLowerCase()
                .replace(/\s+/g, replacement)           // Replace spaces with -
                .replace(reg_exp, index => to.charAt(from.indexOf(index)))
                .replace(/[^\w\-]+/g, '')       // Remove all non-word chars
                .replace(/\-\-+/g, replacement)         // Replace multiple - with single -
                .replace(/^-+/, '')             // Trim - from start of text
                .replace(/-+$/, '')             // Trim - from end of text
                .replace(/[\s_-]+/g, replacement);
        }
    });
});

odoo.define('dynamic_filter.DomainParser', function (require) {
    let core = require('web.core'),
        _t = core._t,
        utils = require('dynamic_filter.Utils');

    /**
     * This class represent a field position inside the domain format of the dynamic filter.
     * We set the start and end position inside the domain format. We get the name between this
     * two positions.
     */
    let Field = core.Class.extend({
        /**
         * Class constructor
         * @param start int the start position of the field inside the domain format
         * @param end int the end position of the field inside the domain format
         * @param text string the text to get the name for the field
         */
        init: function (start, end, text) {
            // we change start with end if start is greater than end
            if (start > end) {
                [start, end] = [end, start];
            }
            this.start = start;
            this.end = end;
            // we get the field name
            this._getFieldName(text);
        },
        /**
         * Extract the field name based on field's start and end position inside the text
         * We dismiss the name if this is empty o equal to _
         * @param text string the text to extract the name for the field
         * @private
         */
        _getFieldName: function (text) {
            this.name = utils.slug(text.substr(this.start + 1, this.end - this.start - 1), '_');
            if ('' === this.name || '_' === this.name) {
                throw new Error(_t("Detected field name is invalid: ") + this.name);
            }
        },
        /**
         * Create the search pattern to replace the field value inside the domain format
         * @returns {string}
         */
        getSearchPattern: function () {
            return '/' + this.name + '/';
        }
    });

    /**
     * Domain parser. This class parse the dynamic filter domain format to find for fields to
     * replace with the field value inside the record data
     */
    return core.Class.extend({
        /**
         * Class constructor
         */
        init: function () {
            this.format = '';
            this.fields = [];
        },
        /**
         * Parse method
         * @param format string the dynamic filter domain format
         * @param data Object the record data
         * @returns {string}
         */
        parse: function (format, data) {
            // if format is undefined we return empty string
            if (!format) {
                return '';
            }
            // if the format is different from the previous parsed format we change it and
            // start looking for new fields replacement.
            if (this.format !== format) {
                this.format = format;
                this.fields = this._extractFields();
            }
            // if data is undefined we return the domain format as it is.
            if (!data) {
                return this.format;
            }
            // replace the fields position inside the domain format with his values.
            return this._replaceFields(data);
        },
        /**
         * Return the domain format with all fields replaced with his correspondents values
         * @param data Object the record data
         * @returns {string} the domain format with all fields positions replaced
         * @private
         */
        _replaceFields: function (data) {
            let result = this.format;
            _.each(this.fields, function (field) {
                //if field is in record data we replace it
                if (field.name in data) {
                    result = result.replace(field.getSearchPattern(), data[field.name]);
                }
            });
            return result;
        },
        /**
         * Find the available fields inside the domain format. We use the convention to express fields
         * as /field_name/. We found the first / sign and the last and the field is the start and end position
         * and the text between.
         * @returns {Array}
         * @private
         */
        _extractFields: function () {
            // find the firs appearance ot the / sign
            let start = this.format.indexOf('/'),
                fields = [];
            // if start is greater or equal than zero and lower than the format string length less 1
            // we proceed to find the next / sign
            while (0 <= start && start < this.format.length - 1) {
                let end = this.format.indexOf('/', start + 1);
                // if there is no more / sign we exit the loop because there is no more fields definition
                if (-1 === end) {
                    break;
                }
                try {
                    //try to create a new field with the start, end positions and the text to extract the name
                    fields.push(new Field(start, end, this.format));
                } catch (e) {
                    console.log(_t("Error extracting field from format: ") + e);
                }
                // find the next start position to find for more field definitions
                start = this.format.indexOf('/', end + 1);
            }
            return fields;
        }
    });
});