const JobModel = require("../models/JobModel");
const UserModel = require("../models/UserModel");
const { body, validationResult } = require("express-validator");
const { constants } = require("../helpers/constants");
const moment = require("moment");
const { sanitizeBody, sanitize } = require("express-validator");
const mailer = require("../helpers/mailer");
const apiResponse = require("../helpers/apiResponse");
const auth = require("../middlewares/jwt");
var mongoose = require("mongoose");
mongoose.set("useFindAndModify", false);

// Job Schema
function jobData(data) {
  this.id = data._id;
  this.title = data.title;
  this.description = data.description;
  this.createdAt = data.createdAt;
  this.skills = data.skills;
  this.vacancies = data.vacancies;
  this.postedBy = data.postedBy;
  this.locations = data.locations;
  this.updatedAt = data.updatedAt;
  this.isDeleted = data.isDeleted;
}

/**
 * All Jobs.
 *
 * @param {string}      id
 *
 * @returns {Object}
 */
exports.JobList = [
  auth,
  body("postedBy", "postedBy must be a String").isString(),
  body("limit", "postedBy must be a String").isString(),
  body("skip", "postedBy must be a String").isString(),
  function (req, res) {
    try {
      const filterObj = {
        isDeleted: false,
      };
      const body = req.body;

      if (body.postedBy) {
        filterObj.postedBy = body.postedBy;
      }

      JobModel.find(
        filterObj,
        {},
        {
          limit: body.limit || 20,
          skip: body.skip || 0,
        }
      )
        .sort("-createdAt")
        .then((Jobs) => {
          if (Jobs.length > 0) {
            let jobs = [];
            Jobs.forEach((job) => {
              let data = new jobData(job);
              jobs.push(data);
            });

            JobModel.count(filterObj, (err, count) => {
              if (err) {
                return apiResponse.ErrorResponse(res, "Operation Failed.", err);
              }

              return apiResponse.successResponseWithData(
                res,
                "Operation success",
                { jobs, count }
              );
            });
          } else {
            return apiResponse.successResponseWithData(
              res,
              "Operation success",
              []
            );
          }
        });
    } catch (err) {
      //throw error in json response with status 500.
      return apiResponse.ErrorResponse(res, err);
    }
  },
];

/**
 * Single Job.
 *
 * @param {string}      id
 *
 * @returns {Object}
 */
exports.JobById = [
  auth,
  body("id", "Id must not be empty.").notEmpty(),
  function (req, res) {
    try {
      JobModel.findOne({ _id: req.body.id }, (error, job) => {
        if (error) {
          return apiResponse.ErrorResponse(res, "Operation Failed.", error);
        }

        if (job) {
          return apiResponse.successResponseWithData(
            res,
            "Operation Succeed.",
            job
          );
        } else {
          return apiResponse.successResponse(res, "Job Not Found.");
        }
      });
    } catch (err) {
      //throw error in json response with status 500.
      return apiResponse.ErrorResponse(res, err);
    }
  },
];

/**
 * Job post to add new job.
 *
 * @param {string}      title
 * @param {string}      description
 * @param {string}      email
 *
 * @returns {Object}
 */
exports.addJob = [
  auth,
  body("title", "Title must not be empty.").notEmpty(),
  body("description", "Description must not be empty.").isLength({ min: 1 }),
  body("skills", "Skills must not be less than 3 character.").notEmpty(),
  body("locations", "Locations must not be empty.").notEmpty(),
  body("vacancies", "Vacancies must not be empty.").notEmpty(),
  (req, res) => {
    try {
      const user = req.user;

      if (user.userType !== constants.userTypes.RECRUITER)
        return apiResponse.unauthorizedResponse(res, "Invalid Permission.");

      const errors = validationResult(req);
      if (!errors.isEmpty()) {
        return apiResponse.validationErrorWithData(
          res,
          "Validation Error.",
          errors.array()
        );
      } else {
        var Job = new JobModel({
          title: req.body.title,
          description: req.body.description,
          skills: req.body.skills,
          locations: req.body.locations,
          vacancies: req.body.vacancies,
          postedBy: user.id,
        });

        Job.save((err, job) => {
          if (err) {
            return apiResponse.validationErrorWithData(
              res,
              "Error Creating Job",
              err
            );
          }

          return apiResponse.successResponseWithData(
            res,
            "Job Created Successfully.",
            job
          );
        });
      }
    } catch (err) {
      //throw error in json response with status 500.
      return apiResponse.ErrorResponse(res, err);
    }
  },
];

exports.applyForJob = [
  auth,
  body("jobId", "jobId must not be empty.").notEmpty(),
  (req, res) => {
    const user = req.user;

    if (user.userType !== constants.userTypes.JOBSEEKER)
      return apiResponse.unauthorizedResponse(res, "Invalid Permission.");

    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return apiResponse.validationErrorWithData(
        res,
        "Validation Error.",
        errors.array()
      );
    }

    const jobId = req.body.jobId;

    // find Job
    JobModel.findOne({ _id: jobId }, (error, result) => {
      if (error) {
        return apiResponse.ErrorResponse(res, "Operation Failed.", error);
      }

      if (!result) {
        return apiResponse.ErrorResponse(res, "Job not found.", error);
      }

      // Check if candidate has already applied or not
      JobModel.findOne(
        {
          _id: jobId,
          applicants: { $elemMatch: { candidate: user.id } },
        },
        (error, result) => {
          if (error) {
            return apiResponse.ErrorResponse(res, "Operation Failed.", error);
          }

          if (!result) {
            // if not applied before
            JobModel.updateOne(
              { _id: mongoose.Types.ObjectId(jobId) },
              {
                $push: {
                  applicants: {
                    candidate: user.id,
                    status: constants.applicationStatus.APPLIED,
                  },
                },
              },
              { new: true },
              (error, result) => {
                if (error) {
                  return apiResponse.ErrorResponse(
                    res,
                    "Operation Failed.",
                    error
                  );
                }

                return apiResponse.successResponse(res, "Applied successfully");
              }
            );
          } else {
            // if applied before
            return apiResponse.ErrorResponse(res, "Already applied.");
          }
        }
      );
    });
  },
];

exports.getJobApplicants = [
  auth,
  body("jobId", "jobId must not be empty").notEmpty().isString(),
  (req, res) => {
    JobModel.findOne({ _id: req.body.jobId }, { applicants: 1, _id: 0 })
      .slice("applicants", 5) // Test this statement
      .populate({
        path: "applicants",
        populate: {
          path: "candidate",
          model: "User",
          select: "_id name email userType",
          populate: {
            path: "jobseeker",
            model: "JobSeeker",
          },
        },
      })
      .exec((err, applicants) => {
        if (err) {
          return apiResponse.ErrorResponse(res, "Operation Failed.", err);
        }
        // TODO: Add limit and skip here
        return apiResponse.successResponseWithData(res, "Success.", applicants);
      });
  },
];

// This function sends interview scheduling mail to cadidate
exports.scheduleInterview = [
  auth,
  body("jobId", "jobId must not be empty.").notEmpty(),
  body("candidateId", "candidateId must not be empty.").notEmpty(),
  body("interviewDate", "interviewDate must not be empty.").notEmpty(),
  body("interviewTime", "interviewTime must not be empty.").notEmpty(),
  body("message", "message must not be empty.").notEmpty(),
  sanitize("*"),
  (req, res) => {
    const user = req.user;

    if (user.userType !== constants.userTypes.RECRUITER)
      return apiResponse.unauthorizedResponse(res, "Invalid Permission.");

    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return apiResponse.validationErrorWithData(
        res,
        "Validation Error.",
        errors.array()
      );
    }

    const { jobId, candidateId, interviewDate, interviewTime, message } =
      req.body;

    JobModel.findOne({ _id: jobId, postedBy: user.id }, (error, job) => {
      if (error) {
        return apiResponse.ErrorResponse(res, "Operation Failed.", error);
      }

      if (!job) {
        return apiResponse.ErrorResponse(res, "Job not found.");
      }

      UserModel.findOne({ _id: candidateId }, (error, user) => {
        if (error) {
          return apiResponse.ErrorResponse(res, "Operation Failed.", error);
        }

        if (!user) {
          return apiResponse.ErrorResponse(res, "Candidate doesn't exists.");
        }

        JobModel.findOneAndUpdate(
          {
            _id: mongoose.Types.ObjectId(jobId),
            "applicants.candidate": candidateId,
            "applicants.status": constants.applicationStatus.APPLIED,
          },
          {
            $set: {
              "applicants.$.status": constants.applicationStatus.INTERVIEWING,
            },
          },
          { new: true },
          (error, result) => {
            if (error) {
              return apiResponse.ErrorResponse(res, "Operation Failed.", error);
            }

            if (!result)
              return apiResponse.ErrorResponse(
                res,
                "Unable to find candidate."
              );

            mailer
              .send(
                constants.confirmEmails.from,
                user.email,
                `Scheduled Interview on ${moment(interviewDate).format(
                  "DD/mm/yyyy"
                )} at ${moment(interviewTime).format("hh:mm A")}`,
                message
              )
              .then(() => {
                return apiResponse.successResponse(res, "Interview scheduled.");
              })
              .catch((error) => {
                if (error) {
                  return apiResponse.ErrorResponse(
                    res,
                    "Operation Failed.",
                    error
                  );
                }
              });
          }
        );
      });
    });
  },
];

// This function sends offer letter to candidtes
exports.sendOfferLetter = [
  auth,
  body("jobId", "jobId must not be empty.").notEmpty(),
  body("candidateId", "candidateId must not be empty.").notEmpty(),
  body("message", "message must not be empty.").notEmpty(),
  sanitize("*"),
  (req, res) => {
    const user = req.user;

    if (user.userType !== constants.userTypes.RECRUITER)
      return apiResponse.unauthorizedResponse(res, "Invalid Permission.");

    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return apiResponse.validationErrorWithData(
        res,
        "Validation Error.",
        errors.array()
      );
    }

    const { jobId, candidateId, message } = req.body;

    JobModel.findOne({ _id: jobId, postedBy: user.id }, (error, job) => {
      if (error) {
        return apiResponse.ErrorResponse(res, "Operation Failed.", error);
      }

      if (!job) {
        return apiResponse.ErrorResponse(res, "Job not found.");
      }

      UserModel.findOne({ _id: candidateId }, (error, user) => {
        if (error) {
          return apiResponse.ErrorResponse(res, "Operation Failed.", error);
        }

        if (!user) {
          return apiResponse.ErrorResponse(res, "Candidate doesn't exists.");
        }

        JobModel.updateOne(
          {
            _id: mongoose.Types.ObjectId(jobId),
            "applicants.candidate": candidateId,
            "applicants.status": constants.applicationStatus.INTERVIEWING,
          },
          {
            $set: {
              "applicants.$.status": constants.applicationStatus.HIRED,
            },
          },
          {
            new: true,
          },
          (error, result) => {
            if (error) {
              return apiResponse.ErrorResponse(res, "Operation Failed.", error);
            }

            if (!result)
              return apiResponse.ErrorResponse(
                res,
                "Unable to find candidate."
              );

            mailer
              .send(
                constants.confirmEmails.from,
                user.email,
                `Offer Letter`,
                message
              )
              .then(() => {
                return apiResponse.successResponse(res, "Offer Letter Sent.");
              })
              .catch((error) => {
                if (error) {
                  return apiResponse.ErrorResponse(
                    res,
                    "Operation Failed.",
                    error
                  );
                }
              });
          }
        );
      });
    });
  },
];

// This function sends regret letter
exports.sendRegretLetter = [
  auth,
  body("jobId", "jobId must not be empty.").notEmpty(),
  body("candidateId", "candidateId must not be empty.").notEmpty(),
  body("message", "message must not be empty.").notEmpty(),
  sanitize("*"),
  (req, res) => {
    const user = req.user;

    if (user.userType !== constants.userTypes.RECRUITER)
      return apiResponse.unauthorizedResponse(res, "Invalid Permission.");

    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return apiResponse.validationErrorWithData(
        res,
        "Validation Error.",
        errors.array()
      );
    }

    const { jobId, candidateId, message } = req.body;

    JobModel.findOne({ _id: jobId, postedBy: user.id }, (error, job) => {
      if (error) {
        return apiResponse.ErrorResponse(res, "Operation Failed.", error);
      }

      if (!job) {
        return apiResponse.ErrorResponse(res, "Job not found.");
      }

      UserModel.findOne({ _id: candidateId }, (error, user) => {
        if (error) {
          return apiResponse.ErrorResponse(res, "Operation Failed.", error);
        }

        if (!user) {
          return apiResponse.ErrorResponse(res, "Candidate doesn't exists.");
        }

        JobModel.updateOne(
          {
            _id: mongoose.Types.ObjectId(jobId),
            "applicants.candidate": candidateId,
            "applicants.status": constants.applicationStatus.INTERVIEWING,
          },
          {
            $set: {
              "applicants.$.status": constants.applicationStatus.REJECTED,
            },
          },
          {
            new: true,
          },
          (error, result) => {
            if (error) {
              return apiResponse.ErrorResponse(res, "Operation Failed.", error);
            }

            if (!result)
              return apiResponse.ErrorResponse(
                res,
                "Unable to find candidate."
              );

            mailer
              .send(
                constants.confirmEmails.from,
                user.email,
                `Regret Letter`,
                message
              )
              .then(() => {
                return apiResponse.successResponse(res, "Regret Letter Sent.");
              })
              .catch((error) => {
                if (error) {
                  return apiResponse.ErrorResponse(
                    res,
                    "Operation Failed.",
                    error
                  );
                }
              });
          }
        );
      });
    });
  },
];
